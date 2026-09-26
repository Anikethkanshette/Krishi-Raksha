"""E2E API tests for Krushi Raksha (FastAPI backend via public URL)."""
import base64
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://farmer-assist-19.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Modules under test: health, dashboard/weather, diary CRUD, assistant (Gemini),
# diagnosis (multipart image -> Gemini), land records (7/12 guidance)

# Small valid JPEG (8x8) with real variance, generated once
_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIA"
    "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA"
    "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3"
    "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm"
    "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA"
    "AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx"
    "BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK"
    "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3"
    "uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii"
    "igD/2Q=="
)


@pytest.fixture(scope="session")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestHealth:
    """Health/root endpoint."""

    def test_root_running(self, api_client):
        r = api_client.get(f"{API}/", timeout=20)
        assert r.status_code == 200
        assert "running" in r.json().get("message", "").lower()


class TestDashboard:
    """Dashboard: live weather, seeded crop, risks."""

    def test_dashboard_live(self, api_client):
        r = api_client.get(f"{API}/dashboard", params={"latitude": 20.0059, "longitude": 73.791}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["weather"]["available"] is True
        assert isinstance(data["weather"]["temperature_c"], (int, float))
        assert any(c["id"] == "crop-soybean" for c in data["crops"]), "Seeded Soybean crop missing"
        assert isinstance(data["risks"], list) and len(data["risks"]) >= 1
        assert data["location"]["name"] == "Nashik, Maharashtra"
        for risk in data["risks"]:
            assert risk["severity"] in {"low", "medium", "high"}
            assert risk["title"] and risk["title_mr"]

    def test_dashboard_default_location(self, api_client):
        r = api_client.get(f"{API}/dashboard", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["weather"]["available"] is True


class TestDiary:
    """Diary CRUD: create -> verify persistence via GET; invalid activity_type -> 422."""

    def test_create_and_get_diary(self, api_client):
        payload = {
            "crop_id": "crop-soybean",
            "crop_name": "Soybean",
            "activity_type": "irrigation",
            "title": f"TEST_Irrigated north plot {uuid.uuid4().hex[:6]}",
            "title_mr": "TEST_पाणी दिले",
            "notes": "test notes",
            "amount": 500,
        }
        r = api_client.post(f"{API}/diary", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        entry = r.json()
        assert entry["id"]
        assert entry["title"] == payload["title"]
        assert entry["activity_type"] == "irrigation"
        assert entry["amount"] == 500

        g = api_client.get(f"{API}/diary", timeout=20)
        assert g.status_code == 200
        ids = [e["id"] for e in g.json()]
        assert entry["id"] in ids, "Created diary entry not persisted"

    def test_invalid_activity_type_returns_422(self, api_client):
        r = api_client.post(
            f"{API}/diary",
            json={"activity_type": "invalid_type", "title": "TEST_bad"},
            timeout=20,
        )
        assert r.status_code == 422


class TestAssistant:
    """AI assistant: Marathi answer persisted to history."""

    def test_marathi_assistant_persists(self, api_client):
        marker = uuid.uuid4().hex[:6]
        question = f"सोयाबीनला पाणी कधी द्यावे? (test {marker})"
        r = api_client.post(f"{API}/assistant", json={"message": question, "language": "mr"}, timeout=90)
        assert r.status_code == 200, r.text
        answer = r.json()
        assert answer["role"] == "assistant"
        content = answer["content"]
        assert content.strip(), "Empty assistant reply"
        # Marathi reply should contain Devanagari characters
        assert any("ऀ" <= ch <= "ॿ" for ch in content), f"Reply not in Marathi: {content[:120]}"

        h = api_client.get(f"{API}/assistant/history", timeout=20)
        assert h.status_code == 200
        contents = [m["content"] for m in h.json()]
        assert any(marker in c for c in contents), "User message not persisted"
        assert any(content[:60] in c for c in contents), "Assistant reply not persisted"

    def test_empty_message_rejected(self, api_client):
        r = api_client.post(f"{API}/assistant", json={"message": "   ", "language": "en"}, timeout=30)
        assert r.status_code == 400


class TestDiagnosis:
    """Diagnosis: multipart image -> Gemini; non-image -> 415."""

    @staticmethod
    def _post_multipart(files, data):
        # Separate client without the JSON Content-Type so requests sets multipart boundary
        return requests.post(f"{API}/diagnosis", files=files, data=data, timeout=120)

    def test_diagnosis_with_image(self, api_client):
        image_bytes = base64.b64decode(_JPEG_B64)
        files = {"image": ("crop.jpg", image_bytes, "image/jpeg")}
        data = {"crop_name": "Soybean", "symptoms": "Yellow spots on lower leaves", "language": "en"}
        r = self._post_multipart(files, data)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] and body["result"].strip()
        assert body["crop_name"] == "Soybean"
        assert "_id" not in body

    def test_diagnosis_rejects_non_image(self, api_client):
        files = {"image": ("notes.txt", b"hello world", "text/plain")}
        data = {"crop_name": "Soybean", "symptoms": "x", "language": "en"}
        r = self._post_multipart(files, data)
        assert r.status_code == 415

    def test_diagnosis_requires_image(self, api_client):
        r = requests.post(f"{API}/diagnosis", data={"crop_name": "Soybean"}, timeout=30)
        assert r.status_code == 422


class TestLandRecords:
    """7/12 land-record guidance + download logging."""

    def test_land_records_info(self, api_client):
        r = api_client.get(f"{API}/land-records", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["official_url"] == "https://bhulekh.mahabhumi.gov.in/"
        assert len(data["steps"]) == 5
        assert [s["number"] for s in data["steps"]] == [1, 2, 3, 4, 5]
        for s in data["steps"]:
            assert s["title"] and s["title_mr"]

    def test_log_download(self, api_client):
        payload = {"district": "Nashik", "taluka": "Niphad", "village": "TEST_Pimplas", "survey_number": "123/1"}
        r = api_client.post(f"{API}/land-records/log-download", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        record = r.json()
        assert record["district"] == "Nashik"
        assert record["official_url"] == "https://bhulekh.mahabhumi.gov.in/"
        assert "_id" not in record


@pytest.fixture(scope="session", autouse=True)
def cleanup(api_client):
    yield
    # Remove TEST_ prefixed diary entries created during this run (best effort)
    try:
        entries = api_client.get(f"{API}/diary", timeout=20).json()
        for e in entries:
            if str(e.get("title", "")).startswith("TEST_"):
                pass  # no DELETE endpoint exists; entries are prefixed TEST_ for identification
    except Exception:
        pass
