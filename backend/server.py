from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from fastapi.security import HTTPBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import logging
import jwt

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


@api_router.post("/auth/login")
async def login(body: LoginBody):
    doc = await db.erp_state.find_one({"_id": STATE_ID}, {"_id": 0})
    state = doc.get("data") if doc else None
    if not state:
        state = seed_state()
        await db.erp_state.replace_one({"_id": STATE_ID}, {"_id": STATE_ID, "data": state}, upsert=True)

    users = state.get("users", [])
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


@api_router.get("/erp/state")
async def get_state(user_id: str = Depends(get_current_user_id)):
    doc = await db.erp_state.find_one({"_id": STATE_ID}, {"_id": 0})
    if not doc or not doc.get("data"):
        state = seed_state()
        await db.erp_state.replace_one({"_id": STATE_ID}, {"_id": STATE_ID, "data": state}, upsert=True)
        return {"data": state, "version": 1}
    return {"data": doc["data"], "version": doc.get("version", 1)}


@api_router.put("/erp/state")
async def put_state(body: StateBody, user_id: str = Depends(get_current_user_id)):
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.erp_state.find_one({"_id": STATE_ID}, {"version": 1})
    version = (existing.get("version", 0) if existing else 0) + 1
    await db.erp_state.replace_one(
        {"_id": STATE_ID},
        {"_id": STATE_ID, "data": body.data, "version": version, "updatedAt": now, "updatedBy": user_id},
        upsert=True,
    )
    return {"ok": True, "version": version}


@api_router.get("/erp/version")
async def get_version(user_id: str = Depends(get_current_user_id)):
    doc = await db.erp_state.find_one({"_id": STATE_ID}, {"version": 1})
    return {"version": (doc.get("version", 0) if doc else 0)}


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
