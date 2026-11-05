from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Query, Response
from fastapi.security import HTTPBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from fastapi.responses import JSONResponse
from record_store import RecordStore, CommitBody, Conflict
from typing import Optional
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import uuid
import logging
import jwt
import requests

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "amrest-erp-jwt-secret-change-me-2026")
JWT_ALG = "HS256"
JWT_EXPIRE_HOURS = 24 * 7  # 1 week
STATE_ID = "amrest-main"

app = FastAPI(title="Transformer ERP & CRM")
api_router = APIRouter(prefix="/api")
logger = logging.getLogger("erp")
logging.basicConfig(level=logging.INFO)


class LoginBody(BaseModel):
    username: str
    password: str


class StateBody(BaseModel):
    data: dict


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    uid = decode_token(token)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return uid


DEFAULT_DOCUMENT_FORMAT_TYPES = [
    "Quotation", "Proforma Invoice", "Sales Order", "Purchase Order",
    "Job Card", "Delivery Challan", "Tax Invoice", "QC Test Report", "Inspection Certificate",
]

DEFAULT_TERMS = {
    "Quotation": ["Prices are Ex-Works.", "GST Extra as Applicable.", "Delivery within 4 Weeks.", "Payment 100% Advance."],
    "Purchase Order": ["Material should be as per specification.", "Delivery within committed date.", "Test certificate mandatory."],
    "Proforma Invoice": ["Payment as per agreed terms.", "Material dispatch after payment confirmation."],
    "Sales Order": ["Order is subject to approved technical specifications.", "Delivery schedule to be mutually agreed."],
    "Delivery Challan": ["Goods received in good condition.", "Customer acknowledgement required."],
    "Job Card": ["Production must follow approved BOM.", "Material issue only against authorized job card."],
    "Tax Invoice": ["Subject to Jaipur jurisdiction.", "Payment due as per invoice terms."],
    "QC Test Report": ["Report valid for tested serial numbers only.", "All tests performed as per applicable standards."],
    "Inspection Certificate": ["Certificate issued after QC verification.", "Dispatch subject to final approval."],
}


def seed_state() -> dict:
    """Minimal server-side seed. The frontend seed.ts contains the full seed for demo data.
    Backend just needs users for login to work if frontend never wrote data yet."""
    today = datetime.now(timezone.utc).isoformat()
    users = [
        {"id": "u-admin", "name": "Admin User", "email": "admin@amrest.in", "username": "admin", "password": "admin123", "role": "admin", "active": True, "createdAt": today},
        {"id": "u-admin-anwar", "name": "Anwar (Admin)", "email": "aaa@amrest.in", "username": "aaa@amrest.in", "password": "anwar@123", "role": "admin", "active": True, "createdAt": today},
        {"id": "u-sales1", "name": "Rohit Sharma", "email": "rohit@amrest.in", "username": "rohit", "password": "sales123", "role": "sales", "active": True, "createdAt": today},
        {"id": "u-sales2", "name": "Priya Mehta", "email": "priya@amrest.in", "username": "priya", "password": "sales123", "role": "sales", "active": True, "createdAt": today},
        {"id": "u-production", "name": "Vikram Production", "email": "production@amrest.in", "username": "production", "password": "prod123", "role": "production", "active": True, "createdAt": today},
        {"id": "u-purchase", "name": "Neha Purchase", "email": "purchase@amrest.in", "username": "purchase", "password": "purchase123", "role": "purchase", "active": True, "createdAt": today},
        {"id": "u-testing", "name": "Amit Testing", "email": "testing@amrest.in", "username": "testing", "password": "test123", "role": "testing", "active": True, "createdAt": today},
        {"id": "u-store", "name": "Sanjay Store", "email": "store@amrest.in", "username": "store", "password": "store123", "role": "store", "active": True, "createdAt": today},
    ]
    doc_formats = []
    for t in DEFAULT_DOCUMENT_FORMAT_TYPES:
        doc_formats.append({
            "id": f"df-{t.lower().replace(' ', '-')}",
            "documentType": t,
            "formatName": f"{t} Standard Format",
            "active": True,
            "companyName": "AMREST ELECTRICALS LIMITED",
            "address": "Plot No. 42, Industrial Area, Jaipur, Rajasthan 302013",
            "gstNo": "08AAGCA1234L1ZP",
            "contactDetails": "info@amrest.in | +91 98765 43210",
            "headerContent": "Registered manufacturer of transformer and electrical equipment.",
            "footerContent": "This is a computer generated document.",
            "terms": [
                {"id": f"{t}-{i}", "text": text, "active": True, "order": i + 1}
                for i, text in enumerate(DEFAULT_TERMS.get(t, ["Terms as mutually agreed."]))
            ],
            "bankDetails": "Bank: HDFC Bank\nA/C Name: AMREST ELECTRICALS LIMITED\nA/C No: 000000000000\nIFSC: HDFC0000000",
            "declaration": "We declare that the information stated in this document is true and correct.",
            "signatureName": "Authorized Signatory",
            "qrCode": True,
            "watermark": "AMREST",
            "fitToSinglePage": False,
            "pageSize": "A4",
            "orientation": "Portrait",
            "createdAt": today,
            "updatedAt": today,
        })
    return {
        "users": users,
        "parties": [],
        "items": [],
        "costings": [],
        "quotations": [],
        "proformas": [],
        "salesOrders": [],
        "purchaseOrders": [],
        "grns": [],
        "materialIssues": [],
        "boms": [],
        "jobCards": [],
        "challans": [],
        "productionEntries": [],
        "serials": [],
        "qcTests": [],
        "qcFormats": [],
        "qcFinalReports": [],
        "leads": [],
        "ctCostings": [],
        "logs": [],
        "settings": {
            "name": "AMREST ELECTRICALS LIMITED",
            "address": "Plot No. 42, Industrial Area, Jaipur, Rajasthan 302013",
            "gst": "08AAGCA1234L1ZP",
            "email": "info@amrest.in",
            "phone": "+91 98765 43210",
            "logoText": "AE",
            "invoicePrefix": "AE",
            "fyStart": "2026-04-01",
            "documentFormats": doc_formats,
        },
    }


@api_router.get("/")
async def root():
    return {"service": "Transformer ERP & CRM", "status": "ok"}


CHUNK_SIZE = 1000  # array items per chunk document (keeps every Mongo doc far below the 16 MB limit)


async def _ensure_chunked():
    """Migrate the legacy single-document state into per-collection chunk documents (once)."""
    meta = await db.erp_state.find_one({"_id": STATE_ID}, {"data": 0})
    if meta and meta.get("storage") == "chunked":
        return meta
    legacy = await db.erp_state.find_one({"_id": STATE_ID})
    state = (legacy or {}).get("data") or seed_state()
    if legacy and legacy.get("data"):
        await db.erp_state_backup.replace_one({"_id": f"{STATE_ID}-pre-chunk"}, {**legacy, "_id": f"{STATE_ID}-pre-chunk", "backedUpAt": datetime.now(timezone.utc).isoformat()}, upsert=True)
    version = (legacy or {}).get("version", 1)
    await _write_keys(state)
    meta = {"_id": STATE_ID, "storage": "chunked", "keys": sorted(state.keys()), "version": version,
            "updatedAt": datetime.now(timezone.utc).isoformat(), "updatedBy": (legacy or {}).get("updatedBy")}
    await db.erp_state.replace_one({"_id": STATE_ID}, meta, upsert=True)
    logger.info("erp_state migrated to chunked storage (%d keys)", len(state))
    return meta


async def _write_keys(changes: dict):
    for key, value in changes.items():
        if isinstance(value, list):
            chunks = [value[i:i + CHUNK_SIZE] for i in range(0, len(value), CHUNK_SIZE)] or [[]]
            for idx, part in enumerate(chunks):
                await db.erp_chunks.replace_one({"_id": f"{key}#{idx}"}, {"_id": f"{key}#{idx}", "key": key, "idx": idx, "kind": "list", "items": part}, upsert=True)
            await db.erp_chunks.delete_many({"key": key, "idx": {"$gte": len(chunks)}})
        else:
            await db.erp_chunks.replace_one({"_id": f"{key}#0"}, {"_id": f"{key}#0", "key": key, "idx": 0, "kind": "value", "value": value}, upsert=True)
            await db.erp_chunks.delete_many({"key": key, "idx": {"$gte": 1}})


async def _read_state(keys: Optional[list] = None) -> dict:
    query = {"key": {"$in": keys}} if keys else {}
    out: dict = {}
    async for c in db.erp_chunks.find(query).sort([("key", 1), ("idx", 1)]):
        if c.get("kind") == "list":
            out.setdefault(c["key"], []).extend(c.get("items", []))
        else:
            out[c["key"]] = c.get("value")
    return out


@api_router.post("/auth/login")
async def login(body: LoginBody):
    await _activate_record_store()
    users = await store.users()
    user = next(
        (u for u in users if u.get("username", "").lower() == body.username.lower() and u.get("password") == body.password),
        None,
    )
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="User is deactivated")
    return {
        "token": create_token(user["id"]),
        "user": {k: v for k, v in user.items() if k != "password"},
    }


store = RecordStore(db, client)


async def _activate_record_store():
    if await store.is_active():
        return
    # One-time migration: back up, migrate, verify counts + stock.
    meta = await _ensure_chunked()
    state = await _read_state()
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    await db.erp_backup_chunks.delete_many({"backup": ts})
    async for c in db.erp_chunks.find({}):
        await db.erp_backup_chunks.insert_one({**c, "_id": f"{ts}:{c['_id']}", "backup": ts})
    report = await store.migrate_from(state, int(meta.get("version", 1)))
    check = (await store.read_state())["data"]
    mismatch = {k: (len(state.get(k) or []), len(check.get(k) or [])) for k in state if isinstance(state.get(k), list) and k != "logs" and len(state.get(k) or []) != len(check.get(k) or [])}
    stock_after = round(sum(float(i.get("currentStock") or 0) for i in check.get("items", [])), 4)
    report.update({"backup": ts, "mismatch": mismatch, "stockAfter": stock_after})
    await db.erp_meta.update_one({"_id": "record-store"}, {"$set": {"migration": report}})
    if mismatch or abs(stock_after - report["stockSum"]) > 0.001:
        await db.erp_meta.update_one({"_id": "record-store"}, {"$set": {"active": False}})
        logger.error("Record-store migration verification FAILED: %s", report)
        raise HTTPException(status_code=500, detail="Storage migration verification failed — old storage kept")
    logger.info("Record-store migration verified: %s", report)


@api_router.get("/erp/state")
async def get_state(user_id: str = Depends(get_current_user_id)):
    await _activate_record_store()
    return await store.read_state()


@api_router.get("/erp/changes")
async def get_changes(since: int = Query(0), user_id: str = Depends(get_current_user_id)):
    return await store.changes_since(since)


@api_router.post("/erp/commit")
async def commit(body: CommitBody, user_id: str = Depends(get_current_user_id)):
    await _activate_record_store()
    try:
        return await store.commit(body, user_id)
    except Conflict as c:
        return JSONResponse(status_code=409, content=c.payload)


@api_router.get("/erp/version")
async def get_version(user_id: str = Depends(get_current_user_id)):
    return {"version": await store.version()}


@api_router.get("/erp/migration-report")
async def migration_report(user_id: str = Depends(get_current_user_id)):
    m = await db.erp_meta.find_one({"_id": "record-store"})
    return {"active": bool(m and m.get("active")), "report": (m or {}).get("migration")}


@api_router.api_route("/erp/state", methods=["PUT", "PATCH"])
async def legacy_save(user_id: str = Depends(get_current_user_id)):
    # Old browser tabs must reload — whole-state saves are disabled to prevent overwrites.
    raise HTTPException(status_code=426, detail="ERP was updated. Please reload the page (your browser tab is outdated).")


# ---------------------------------------------------------------------------
# File / Object Storage (Emergent Storage)
# ---------------------------------------------------------------------------

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "amrest-erp"
_storage_key: Optional[str] = None

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
    "pdf": "application/pdf", "json": "application/json",
    "csv": "text/csv", "txt": "text/plain",
}

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


def init_storage() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY missing")
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if resp.status_code == 403:
        # Refresh key and retry once
        global _storage_key
        _storage_key = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60,
    )
    if resp.status_code == 403:
        global _storage_key
        _storage_key = None
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key}, timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


@app.on_event("startup")
async def _startup_storage():
    try:
        if EMERGENT_KEY:
            init_storage()
            logger.info("Emergent object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")

    try:
        await store.init()
        await _activate_record_store()
        users = await store.users()
        if not any((u.get("username", "").lower() == "aaa@amrest.in") for u in users):
            from record_store import Op
            await store.commit(CommitBody(opId="seed-admin-anwar", ops=[Op(kind="upsert", coll="users", rid="u-admin-anwar", data={
                "id": "u-admin-anwar", "name": "Anwar (Admin)", "email": "aaa@amrest.in", "username": "aaa@amrest.in",
                "password": "anwar@123", "role": "admin", "active": True, "createdAt": datetime.now(timezone.utc).isoformat()})]), "system")
    except Exception as e:
        logger.error(f"Record store startup failed: {e}")


async def get_current_user_from_any(
    authorization: Optional[str] = Header(None),
    auth: Optional[str] = Query(None),
) -> str:
    """Accept token via Authorization header OR ?auth= query param (used for <img> tags)."""
    token: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    elif auth:
        token = auth
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    uid_ = decode_token(token)
    if not uid_:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return uid_


@api_router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    category: str = Query("general"),
    user_id: str = Depends(get_current_user_id),
):
    """Upload a file to object storage. Returns id + url that the frontend can use in <img src>."""
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "bin"
    if len(ext) > 8:
        ext = "bin"
    content_type = file.content_type or MIME_TYPES.get(ext, "application/octet-stream")
    safe_category = "".join(c for c in category if c.isalnum() or c in ("-", "_")).lower() or "general"
    path = f"{APP_NAME}/{safe_category}/{user_id}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, content_type)
    except Exception as e:
        logger.exception("upload failed")
        raise HTTPException(status_code=502, detail=f"Upload failed: {e}")
    file_id = str(uuid.uuid4())
    record = {
        "_id": file_id,
        "id": file_id,
        "storage_path": result.get("path", path),
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "category": safe_category,
        "uploaded_by": user_id,
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.files.insert_one(record)
    return {
        "id": file_id,
        "path": record["storage_path"],
        "filename": file.filename,
        "content_type": content_type,
        "size": record["size"],
        "url": f"/api/files/{file_id}",
    }


@api_router.get("/files/{file_id}")
async def download_file(
    file_id: str,
    user_id: str = Depends(get_current_user_from_any),
):
    record = await db.files.find_one({"_id": file_id, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, ct = get_object(record["storage_path"])
    except Exception as e:
        logger.exception("download failed")
        raise HTTPException(status_code=502, detail=f"Download failed: {e}")
    return Response(content=data, media_type=record.get("content_type") or ct)


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.files.update_one(
        {"_id": file_id, "is_deleted": False},
        {"$set": {"is_deleted": True, "deleted_at": datetime.now(timezone.utc).isoformat(), "deleted_by": user_id}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
