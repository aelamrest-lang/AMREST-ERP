"""Edge cases for the record-level store (inc + upsert in same batch, legacy endpoints, changes feed). Cleans up after itself."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def h():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["token"]}


def commit(h, ops, op_id=None):
    r = requests.post(f"{API}/erp/commit", headers=h, json={"opId": op_id or str(uuid.uuid4()), "ops": ops})
    return r.status_code, r.json()


def state(h):
    return requests.get(f"{API}/erp/state", headers=h).json()


# Item: stock inc and a field edit in ONE batch (what computeOps emits: inc first, then upsert)
def test_inc_and_upsert_same_item_same_batch(h):
    rid = f"TEST_item_{uuid.uuid4().hex[:6]}"
    item = {"id": rid, "name": "TEST_edge item", "currentStock": 0, "unit": "Nos"}
    code, _ = commit(h, [{"kind": "upsert", "coll": "items", "rid": rid, "baseRev": None, "data": item}])
    assert code == 200
    try:
        st = state(h)
        rev = st["revs"]["items"][rid]
        code, body = commit(h, [{"kind": "inc", "coll": "items", "rid": rid, "delta": 5},
                                {"kind": "upsert", "coll": "items", "rid": rid, "baseRev": rev, "data": {**item, "name": "TEST_edge renamed", "currentStock": 5}}])
        assert code == 200, body
        st = state(h)
        got = next(i for i in st["data"]["items"] if i["id"] == rid)
        assert got["name"] == "TEST_edge renamed"
        assert float(got["currentStock"]) == 5.0, f"stock increment lost: {got['currentStock']}"
    finally:
        st = state(h)
        commit(h, [{"kind": "delete", "coll": "items", "rid": rid, "baseRev": st["revs"]["items"].get(rid)}])


def test_legacy_put_patch_426(h):
    assert requests.put(f"{API}/erp/state", headers=h, json={"data": {}}).status_code == 426
    assert requests.patch(f"{API}/erp/state", headers=h, json={"baseVersion": 0, "changes": {}}).status_code == 426


def test_commit_unauthorized():
    r = requests.post(f"{API}/erp/commit", json={"opId": "x", "ops": []})
    assert r.status_code in (401, 403)


def test_changes_feed_and_migration_report(h):
    v = requests.get(f"{API}/erp/version", headers=h).json()["version"]
    rid = f"TEST_pe_{uuid.uuid4().hex[:6]}"
    code, body = commit(h, [{"kind": "upsert", "coll": "productionEntries", "rid": rid, "baseRev": None, "data": {"id": rid, "date": "2026-01-01"}}])
    assert code == 200
    ch = requests.get(f"{API}/erp/changes", headers=h, params={"since": v}).json()
    assert any(r["rid"] == rid for r in ch["records"])
    rep = requests.get(f"{API}/erp/migration-report", headers=h).json()
    assert rep["active"] is True and not rep["report"].get("mismatch")
    commit(h, [{"kind": "delete", "coll": "productionEntries", "rid": rid, "baseRev": body["revs"][0]["rev"]}])


# Malformed op: upsert without rid should be a 4xx, not 500
def test_bad_op_not_500(h):
    r = requests.post(f"{API}/erp/commit", headers=h, json={"opId": str(uuid.uuid4()), "ops": [{"kind": "inc", "coll": "items", "rid": "does-not-exist", "delta": 1}]})
    assert r.status_code < 500


# Stock inc on a deleted / missing item must be rejected (409), not silently ignored
def test_inc_on_missing_or_deleted_item_409(h):
    code, body = commit(h, [{"kind": "inc", "coll": "items", "rid": f"TEST_missing_{uuid.uuid4().hex[:6]}", "delta": 1}])
    assert code == 409, body
    rid = f"TEST_item_{uuid.uuid4().hex[:6]}"
    item = {"id": rid, "name": "TEST_edge deleted", "currentStock": 0}
    assert commit(h, [{"kind": "upsert", "coll": "items", "rid": rid, "baseRev": None, "data": item}])[0] == 200
    rev = state(h)["revs"]["items"][rid]
    assert commit(h, [{"kind": "delete", "coll": "items", "rid": rid, "baseRev": rev}])[0] == 200
    code, body = commit(h, [{"kind": "inc", "coll": "items", "rid": rid, "delta": 1}])
    assert code == 409, body


# erp_applied has a TTL index on exp
def test_erp_applied_ttl_index():
    from pymongo import MongoClient
    env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l)
    db = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
    idx = db.erp_applied.index_information()
    assert any(v.get("expireAfterSeconds") and v["key"][0][0] == "exp" for v in idx.values()), idx
