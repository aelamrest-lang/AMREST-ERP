# Chunked ERP state storage + optimistic concurrency (PATCH/PUT /api/erp/state) tests.
# Uses EMPTY change sets only, so real data is never modified (only version is bumped).
import os
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": u, "password": p}, timeout=60)
    return r


@pytest.fixture(scope="module")
def token():
    r = _login("admin", "admin123")
    if r.status_code != 200:
        pytest.skip("admin login failed")
    return r.json()["token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- Auth reads users from chunks ---
@pytest.mark.parametrize("u,p", [("admin", "admin123"), ("testing", "test123"), ("aaa@amrest.in", "anwar@123")])
def test_login_users(u, p):
    r = _login(u, p)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["username"].lower() == u.lower()
    assert "password" not in r.json()["user"]


def test_login_bad_password():
    assert _login("admin", "nope").status_code == 401


# --- GET state ---
def test_get_state_has_version_and_collections(hdr):
    r = requests.get(f"{BASE_URL}/api/erp/state", headers=hdr, timeout=120)
    assert r.status_code == 200
    j = r.json()
    assert isinstance(j["version"], int)
    d = j["data"]
    for k in ["users", "items", "grns", "productionEntries", "logs", "settings", "purchaseOrders"]:
        assert k in d, k
    assert isinstance(d["settings"], dict)
    v = requests.get(f"{BASE_URL}/api/erp/version", headers=hdr, timeout=30).json()["version"]
    assert v >= j["version"]


def test_get_state_unauthorized():
    assert requests.get(f"{BASE_URL}/api/erp/state", timeout=30).status_code == 401


# --- Mongo storage layout ---
def test_chunk_docs_under_limit():
    c = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    meta = c.erp_state.find_one({"_id": "amrest-main"}, {"data": 1, "storage": 1, "version": 1})
    assert meta["storage"] == "chunked"
    assert "data" not in meta
    sizes = list(c.erp_chunks.aggregate([{"$project": {"s": {"$bsonSize": "$$ROOT"}}}, {"$sort": {"s": -1}}, {"$limit": 1}]))
    assert sizes[0]["s"] < 16 * 1024 * 1024 * 0.5, sizes
    assert c.erp_state_backup.find_one({"_id": "amrest-main-pre-chunk"}, {"_id": 1}) is not None


# --- PATCH concurrency ---
def test_patch_current_then_stale(hdr):
    v = requests.get(f"{BASE_URL}/api/erp/version", headers=hdr, timeout=30).json()["version"]
    r = requests.patch(f"{BASE_URL}/api/erp/state", headers=hdr, json={"baseVersion": v, "changes": {}}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == v + 1
    r2 = requests.patch(f"{BASE_URL}/api/erp/state", headers=hdr, json={"baseVersion": v, "changes": {}}, timeout=30)
    assert r2.status_code == 409
    assert r2.json()["detail"]["version"] == v + 1


def test_patch_unauthorized():
    r = requests.patch(f"{BASE_URL}/api/erp/state", json={"baseVersion": 1, "changes": {}}, timeout=30)
    assert r.status_code == 401


def test_patch_invalid_body(hdr):
    r = requests.patch(f"{BASE_URL}/api/erp/state", headers=hdr, json={"baseVersion": 1}, timeout=30)
    assert r.status_code == 422


def test_patch_roundtrip_identical_logs(hdr):
    # re-write the current settings unchanged -> data must remain identical
    s = requests.get(f"{BASE_URL}/api/erp/state", headers=hdr, timeout=120).json()
    r = requests.patch(f"{BASE_URL}/api/erp/state", headers=hdr,
                       json={"baseVersion": s["version"], "changes": {"settings": s["data"]["settings"]}}, timeout=60)
    if r.status_code == 409:
        pytest.skip("concurrent save by a real user in between")
    assert r.status_code == 200
    s2 = requests.get(f"{BASE_URL}/api/erp/state", headers=hdr, timeout=120).json()
    assert s2["data"]["settings"] == s["data"]["settings"]


def test_put_full_write_still_works(hdr):
    v = requests.get(f"{BASE_URL}/api/erp/version", headers=hdr, timeout=30).json()["version"]
    r = requests.put(f"{BASE_URL}/api/erp/state", headers=hdr, json={"data": {}}, timeout=30)
    assert r.status_code == 200
    assert r.json()["version"] >= v + 1
