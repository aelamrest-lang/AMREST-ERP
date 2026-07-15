"""Backend API tests for AMREST Transformer ERP & CRM."""
import os
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


# --- Root / service info ---
class TestRoot:
    def test_root_returns_service_info(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        data = r.json()
        assert data.get("service") == "Transformer ERP & CRM"
        assert data.get("status") == "ok"


# --- Auth ---
class TestAuth:
    def test_login_admin_success(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login",
                            json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
        assert "user" in data
        user = data["user"]
        assert user["username"] == "admin"
        assert user["role"] == "admin"
        # password must not be returned
        assert "password" not in user

    def test_login_all_seed_users(self, api_client):
        creds = [
            ("rohit", "sales123", "sales"),
            ("priya", "sales123", "sales"),
            ("production", "prod123", "production"),
            ("purchase", "purchase123", "purchase"),
            ("testing", "test123", "testing"),
            ("store", "store123", "store"),
        ]
        for u, p, role in creds:
            r = api_client.post(f"{BASE_URL}/api/auth/login", json={"username": u, "password": p})
            assert r.status_code == 200, f"Login failed for {u}: {r.text}"
            assert r.json()["user"]["role"] == role

    def test_login_wrong_password_401(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login",
                            json={"username": "admin", "password": "wrongpass"})
        assert r.status_code == 401
        assert "detail" in r.json()

    def test_login_unknown_user_401(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login",
                            json={"username": "ghost", "password": "x"})
        assert r.status_code == 401


# --- ERP state ---
class TestErpState:
    def test_state_without_auth_returns_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/erp/state")
        assert r.status_code == 401

    def test_state_with_bad_token_returns_401(self, api_client):
        api_client.headers["Authorization"] = "Bearer not-a-real-token"
        r = api_client.get(f"{BASE_URL}/api/erp/state")
        assert r.status_code == 401

    def test_get_state_with_valid_token(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/erp/state")
        assert r.status_code == 200
        body = r.json()
        assert "data" in body and "version" in body
        assert isinstance(body["version"], int)
        d = body["data"]
        for key in ("users", "parties", "items", "settings"):
            assert key in d, f"missing key: {key}"
        assert isinstance(d["users"], list) and len(d["users"]) >= 7
        assert isinstance(d["parties"], list)
        assert isinstance(d["items"], list)
        assert isinstance(d["settings"], dict)
        assert d["settings"].get("name") == "AMREST ELECTRICALS LIMITED"

    def test_version_endpoint(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/erp/version")
        assert r.status_code == 200
        v = r.json().get("version")
        assert isinstance(v, int) and v >= 0

    def test_put_state_increments_version_and_persists(self, auth_client):
        # get initial state
        r0 = auth_client.get(f"{BASE_URL}/api/erp/state")
        assert r0.status_code == 200
        state = r0.json()["data"]
        v0 = auth_client.get(f"{BASE_URL}/api/erp/version").json()["version"]

        # mutate: add a TEST_ marker in settings
        state = dict(state)
        settings = dict(state.get("settings", {}))
        settings["TEST_marker"] = f"pytest-marker-{v0}"
        state["settings"] = settings

        r1 = auth_client.put(f"{BASE_URL}/api/erp/state", json={"data": state})
        assert r1.status_code == 200
        j = r1.json()
        assert j.get("ok") is True
        assert j.get("version") == v0 + 1

        # verify persistence
        r2 = auth_client.get(f"{BASE_URL}/api/erp/state")
        assert r2.status_code == 200
        body = r2.json()
        assert body["version"] == v0 + 1
        assert body["data"]["settings"].get("TEST_marker") == f"pytest-marker-{v0}"

        # cleanup: remove marker
        state2 = body["data"]
        settings2 = dict(state2.get("settings", {}))
        settings2.pop("TEST_marker", None)
        state2["settings"] = settings2
        auth_client.put(f"{BASE_URL}/api/erp/state", json={"data": state2})

    def test_put_state_without_auth_returns_401(self, api_client):
        r = api_client.put(f"{BASE_URL}/api/erp/state", json={"data": {}})
        assert r.status_code == 401
