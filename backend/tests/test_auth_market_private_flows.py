"""Critical auth + privacy + marketplace tests against public Krushi Raksha API."""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# Modules under test: auth session checks, private data isolation, marketplace lifecycle/concurrency.


def _load_base_url() -> str:
    load_dotenv(Path('/app/frontend/.env'))
    base = os.environ.get('EXPO_PUBLIC_BACKEND_URL')
    if not base:
        pytest.fail('EXPO_PUBLIC_BACKEND_URL is missing. Cannot run public endpoint tests.')
    return base.rstrip('/')


BASE_URL = _load_base_url()
API = f"{BASE_URL}/api"


def _iso_day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


@pytest.fixture(scope='session')
def api_client():
    session = requests.Session()
    session.headers.update({'Content-Type': 'application/json'})
    return session


@pytest.fixture(scope='session')
def mongo_db():
    load_dotenv(Path('/app/backend/.env'))
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME')
    if not mongo_url or not db_name:
        pytest.fail('MONGO_URL or DB_NAME missing; cannot seed synthetic identities.')
    client = MongoClient(mongo_url, tz_aware=True)
    db = client[db_name]
    yield db
    client.close()


@pytest.fixture(scope='session')
def seeded_users(mongo_db, worker_id):
    now = datetime.now(timezone.utc)
    users = [
        {
            'user_id': 'TEST_user_owner_api',
            'email': 'test.owner.api@example.com',
            'name': 'TEST Owner API',
            'picture': '',
            'created_at': now,
            'token': f'test_tok_owner_{uuid.uuid4().hex}',
        },
        {
            'user_id': 'TEST_user_renter_api',
            'email': 'test.renter.api@example.com',
            'name': 'TEST Renter API',
            'picture': '',
            'created_at': now,
            'token': f'test_tok_renter_{uuid.uuid4().hex}',
        },
        {
            'user_id': 'TEST_user_outsider_api',
            'email': 'test.outsider.api@example.com',
            'name': 'TEST Outsider API',
            'picture': '',
            'created_at': now,
            'token': f'test_tok_outsider_{uuid.uuid4().hex}',
        },
    ]

    # Parallel pytest workers must never share account IDs: one worker's teardown
    # must not delete a different worker's still-active authorization fixtures.
    for user in users:
        user['user_id'] = f"{user['user_id']}_{worker_id}"
        local, domain = user['email'].split('@')
        user['email'] = f'{local}.{worker_id}@{domain}'

    # Seed short-lived sessions (same shape as backend exchange flow).
    for user in users:
        mongo_db.users.update_one(
            {'user_id': user['user_id']},
            {
                '$set': {
                    'email': user['email'],
                    'name': user['name'],
                    'picture': user['picture'],
                    'created_at': user['created_at'],
                }
            },
            upsert=True,
        )
        mongo_db.user_sessions.update_one(
            {'session_token': user['token']},
            {
                '$set': {
                    'user_id': user['user_id'],
                    'expires_at': now + timedelta(hours=1),
                    'created_at': now,
                }
            },
            upsert=True,
        )

    yield users

    user_ids = [u['user_id'] for u in users]
    emails = [u['email'] for u in users]
    tokens = [u['token'] for u in users]
    mongo_db.user_sessions.delete_many({'session_token': {'$in': tokens}})
    mongo_db.users.delete_many({'user_id': {'$in': user_ids}, 'email': {'$in': emails}})
    mongo_db.crops.delete_many({'user_id': {'$in': user_ids}})
    mongo_db.diary.delete_many({'user_id': {'$in': user_ids}})
    mongo_db.assistant_turns.delete_many({'user_id': {'$in': user_ids}})
    mongo_db.diagnoses.delete_many({'user_id': {'$in': user_ids}})
    mongo_db.listings.delete_many({'owner_id': {'$in': user_ids}})


def _auth_header(token: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {token}'}


class TestAuthContract:
    """Auth endpoint contract and protected route behavior."""

    def test_private_route_requires_token(self, api_client):
        r = api_client.get(f'{API}/auth/me', timeout=20)
        assert r.status_code == 401

    def test_invalid_and_expired_tokens_return_401(self, api_client, mongo_db):
        invalid = api_client.get(f'{API}/auth/me', headers=_auth_header('not-a-real-token'), timeout=20)
        assert invalid.status_code == 401

        expired_token = f'test_expired_{uuid.uuid4().hex}'
        mongo_db.user_sessions.insert_one(
            {
                'session_token': expired_token,
                'user_id': f'TEST_expired_user_{uuid.uuid4().hex[:6]}',
                'created_at': datetime.now(timezone.utc) - timedelta(days=2),
                'expires_at': datetime.now(timezone.utc) - timedelta(minutes=1),
            }
        )
        try:
            expired = api_client.get(f'{API}/auth/me', headers=_auth_header(expired_token), timeout=20)
            assert expired.status_code == 401
        finally:
            mongo_db.user_sessions.delete_one({'session_token': expired_token})

    def test_auth_session_validates_payload(self, api_client):
        bad_session = api_client.post(f'{API}/auth/session', json={'session_id': 'definitely-invalid'}, timeout=25)
        assert bad_session.status_code in {401, 503}

        wrong_field = api_client.post(
            f'{API}/auth/session', json={'session_token': 'wrong-shape'}, timeout=20
        )
        assert wrong_field.status_code == 422

    def test_me_and_logout_revoke_session(self, api_client, seeded_users, mongo_db):
        owner = seeded_users[0]
        me = api_client.get(f'{API}/auth/me', headers=_auth_header(owner['token']), timeout=20)
        assert me.status_code == 200
        assert me.json()['user_id'] == owner['user_id']

        temp_token = f'test_temp_logout_{uuid.uuid4().hex}'
        mongo_db.user_sessions.insert_one(
            {
                'session_token': temp_token,
                'user_id': owner['user_id'],
                'created_at': datetime.now(timezone.utc),
                'expires_at': datetime.now(timezone.utc) + timedelta(days=1),
            }
        )
        out = api_client.post(f'{API}/auth/logout', headers=_auth_header(temp_token), timeout=20)
        assert out.status_code == 200

        revoked = api_client.get(f'{API}/auth/me', headers=_auth_header(temp_token), timeout=20)
        assert revoked.status_code == 401


class TestPrivateIsolation:
    """Per-user ownership isolation for diary/crops/assistant/diagnosis/location."""

    def test_diary_crop_and_location_isolation(self, api_client, seeded_users):
        owner, renter = seeded_users[0], seeded_users[1]

        diary = api_client.post(
            f'{API}/diary',
            headers=_auth_header(owner['token']),
            json={
                'crop_id': 'manual',
                'crop_name': 'TEST Soybean',
                'activity_type': 'expense',
                'title': f'TEST_Diary_{uuid.uuid4().hex[:6]}',
                'title_mr': 'TEST_नोंद',
                'notes': 'TEST owner private diary',
                'amount': 100,
            },
            timeout=20,
        )
        assert diary.status_code == 200
        entry_id = diary.json()['id']

        renter_diary = api_client.get(f'{API}/diary', headers=_auth_header(renter['token']), timeout=20)
        assert all(item['id'] != entry_id for item in renter_diary.json())

        cross_delete = api_client.delete(
            f'{API}/diary/{entry_id}', headers=_auth_header(renter['token']), timeout=20
        )
        assert cross_delete.status_code == 404

        crop = api_client.post(
            f'{API}/crops',
            headers=_auth_header(owner['token']),
            json={'name': 'TEST Onion', 'variety': 'N-53', 'area_acres': 1.2},
            timeout=20,
        )
        assert crop.status_code == 200
        crop_id = crop.json()['id']

        owner_crops = api_client.get(f'{API}/crops', headers=_auth_header(owner['token']), timeout=20)
        renter_crops = api_client.get(f'{API}/crops', headers=_auth_header(renter['token']), timeout=20)
        assert any(c['id'] == crop_id for c in owner_crops.json())
        assert all(c['id'] != crop_id for c in renter_crops.json())

        loc_owner = {
            'name': 'Pune, Maharashtra',
            'latitude': 18.5204,
            'longitude': 73.8567,
            'source': 'manual',
            'accuracy': None,
        }
        loc_renter = {
            'name': 'Nashik, Maharashtra',
            'latitude': 19.9975,
            'longitude': 73.7898,
            'source': 'manual',
            'accuracy': None,
        }
        save_owner = api_client.put(f'{API}/location', headers=_auth_header(owner['token']), json=loc_owner, timeout=20)
        save_renter = api_client.put(f'{API}/location', headers=_auth_header(renter['token']), json=loc_renter, timeout=20)
        assert save_owner.status_code == 200
        assert save_renter.status_code == 200

        get_owner = api_client.get(f'{API}/location', headers=_auth_header(owner['token']), timeout=20)
        get_renter = api_client.get(f'{API}/location', headers=_auth_header(renter['token']), timeout=20)
        assert get_owner.json()['name'] == 'Pune, Maharashtra'
        assert get_renter.json()['name'] == 'Nashik, Maharashtra'

    def test_assistant_history_and_diagnoses_owner_only(self, api_client, seeded_users, mongo_db):
        owner, renter = seeded_users[0], seeded_users[1]
        marker = uuid.uuid4().hex[:6]
        now = datetime.now(timezone.utc).isoformat()
        mongo_db.assistant_turns.insert_one(
            {
                'id': str(uuid.uuid4()),
                'user_id': owner['user_id'],
                'created_at': now,
                'messages': [
                    {'id': str(uuid.uuid4()), 'role': 'user', 'content': f'TEST owner question {marker}', 'created_at': now},
                    {'id': str(uuid.uuid4()), 'role': 'assistant', 'content': f'TEST owner answer {marker}', 'created_at': now},
                ],
            }
        )
        mongo_db.diagnoses.insert_one(
            {
                'id': str(uuid.uuid4()),
                'user_id': owner['user_id'],
                'crop_name': 'TEST Soybean',
                'symptoms': 'TEST spots',
                'result': f'TEST diagnosis {marker}',
                'created_at': now,
            }
        )

        owner_history = api_client.get(f'{API}/assistant/history', headers=_auth_header(owner['token']), timeout=25)
        renter_history = api_client.get(f'{API}/assistant/history', headers=_auth_header(renter['token']), timeout=25)
        assert any(marker in msg['content'] for msg in owner_history.json())
        assert all(marker not in msg['content'] for msg in renter_history.json())

        owner_diag = api_client.get(f'{API}/diagnoses', headers=_auth_header(owner['token']), timeout=20)
        renter_diag = api_client.get(f'{API}/diagnoses', headers=_auth_header(renter['token']), timeout=20)
        assert any(marker in item['result'] for item in owner_diag.json())
        assert all(marker not in item['result'] for item in renter_diag.json())

    def test_unowned_seed_not_visible(self, api_client, seeded_users, mongo_db):
        owner = seeded_users[0]
        orphan_id = f'TEST_orphan_{uuid.uuid4().hex[:6]}'
        mongo_db.crops.insert_one(
            {
                'id': orphan_id,
                'name': 'TEST Orphan Crop',
                'name_mr': 'TEST अनाथ',
                'variety': 'TEST',
                'area_acres': 1,
                'next_action': 'TEST',
                'next_action_mr': 'TEST',
                'created_at': datetime.now(timezone.utc).isoformat(),
            }
        )
        try:
            crops = api_client.get(f'{API}/crops', headers=_auth_header(owner['token']), timeout=20)
            assert all(item['id'] != orphan_id for item in crops.json())
        finally:
            mongo_db.crops.delete_one({'id': orphan_id})


class TestMarketplaceFlows:
    """Tools/work listing creation, privacy, request lifecycle, and conflict handling."""

    def _create_tool_listing(self, api_client, token: str, title_suffix: str) -> dict[str, Any]:
        payload = {
            'kind': 'tool',
            'title': f'TEST Tractor {title_suffix}',
            'category': 'tractor',
            'description': 'TEST Tractor in good condition with driver support available.',
            'daily_rate': 2500,
            'location_name': 'Pune, Maharashtra',
            'latitude': 18.5204,
            'longitude': 73.8567,
            'phone': '+919876543210',
            'start_date': _iso_day(2),
            'end_date': _iso_day(8),
            'people': 1,
        }
        created = api_client.post(f'{API}/market/listings', headers=_auth_header(token), json=payload, timeout=20)
        assert created.status_code == 201, created.text
        return created.json()

    def test_listing_validation_and_filters(self, api_client, seeded_users):
        owner = seeded_users[0]
        created = self._create_tool_listing(api_client, owner['token'], uuid.uuid4().hex[:6])
        listing_id = created['id']

        invalid_phone = api_client.post(
            f'{API}/market/listings',
            headers=_auth_header(owner['token']),
            json={
                'kind': 'tool',
                'title': 'TEST Bad Phone',
                'category': 'tractor',
                'description': 'TEST invalid phone listing description long enough.',
                'daily_rate': 2000,
                'location_name': 'Pune',
                'latitude': 18.52,
                'longitude': 73.85,
                'phone': '123',
                'start_date': _iso_day(2),
                'end_date': _iso_day(4),
                'people': 1,
            },
            timeout=20,
        )
        assert invalid_phone.status_code == 422

        invalid_category = api_client.post(
            f'{API}/market/listings',
            headers=_auth_header(owner['token']),
            json={
                'kind': 'tool',
                'title': 'TEST Bad Category',
                'category': 'invalid-cat',
                'description': 'TEST invalid category listing description long enough.',
                'daily_rate': 2000,
                'location_name': 'Pune',
                'latitude': 18.52,
                'longitude': 73.85,
                'phone': '+919876543210',
                'start_date': _iso_day(2),
                'end_date': _iso_day(4),
                'people': 1,
            },
            timeout=20,
        )
        assert invalid_category.status_code == 422

        nearby = api_client.get(
            f'{API}/market/listings',
            headers=_auth_header(owner['token']),
            params={'board': 'tools', 'radius': 25, 'latitude': 18.52, 'longitude': 73.85, 'q': 'Tractor'},
            timeout=20,
        )
        assert nearby.status_code == 200
        assert any(item['id'] == listing_id for item in nearby.json())
        sample = next(item for item in nearby.json() if item['id'] == listing_id)
        assert 'phone' in sample and sample['phone'] is not None  # owner sees own phone
        assert 'latitude' not in sample and 'longitude' not in sample

        mine = api_client.get(
            f'{API}/market/listings',
            headers=_auth_header(owner['token']),
            params={'board': 'tools', 'mine': True},
            timeout=20,
        )
        assert mine.status_code == 200
        assert any(item['id'] == listing_id for item in mine.json())

        detail = api_client.get(f'{API}/market/listings/{listing_id}', headers=_auth_header(owner['token']), timeout=20)
        assert detail.status_code == 200
        assert detail.json()['id'] == listing_id

    def test_request_accept_privacy_duplicate_and_permissions(self, api_client, seeded_users):
        owner, renter, outsider = seeded_users[0], seeded_users[1], seeded_users[2]
        listing = self._create_tool_listing(api_client, owner['token'], f'flow-{uuid.uuid4().hex[:6]}')
        listing_id = listing['id']

        self_request = api_client.post(
            f'{API}/market/listings/{listing_id}/requests',
            headers=_auth_header(owner['token']),
            json={'phone': '+919812345678', 'message': 'TEST self', 'start_date': _iso_day(3), 'end_date': _iso_day(4)},
            timeout=20,
        )
        assert self_request.status_code == 400

        renter_req = api_client.post(
            f'{API}/market/listings/{listing_id}/requests',
            headers=_auth_header(renter['token']),
            json={'phone': '+919812345678', 'message': 'TEST request', 'start_date': _iso_day(3), 'end_date': _iso_day(5)},
            timeout=20,
        )
        assert renter_req.status_code == 200
        my_request = renter_req.json()['my_request']
        assert my_request['status'] == 'pending'
        request_id = my_request['id']

        duplicate = api_client.post(
            f'{API}/market/listings/{listing_id}/requests',
            headers=_auth_header(renter['token']),
            json={'phone': '+919812345678', 'message': 'TEST duplicate', 'start_date': _iso_day(3), 'end_date': _iso_day(5)},
            timeout=20,
        )
        assert duplicate.status_code == 409

        non_owner_close = api_client.patch(
            f'{API}/market/listings/{listing_id}',
            headers=_auth_header(renter['token']),
            json={'status': 'closed'},
            timeout=20,
        )
        assert non_owner_close.status_code == 404

        non_owner_accept = api_client.patch(
            f'{API}/market/listings/{listing_id}/requests/{request_id}',
            headers=_auth_header(renter['token']),
            json={'status': 'accepted'},
            timeout=20,
        )
        assert non_owner_accept.status_code == 403

        owner_accept = api_client.patch(
            f'{API}/market/listings/{listing_id}/requests/{request_id}',
            headers=_auth_header(owner['token']),
            json={'status': 'accepted'},
            timeout=20,
        )
        assert owner_accept.status_code == 200

        owner_activity = api_client.get(f'{API}/market/activity', headers=_auth_header(owner['token']), params={'board': 'tools'}, timeout=20)
        renter_activity = api_client.get(f'{API}/market/activity', headers=_auth_header(renter['token']), params={'board': 'tools'}, timeout=20)
        outsider_activity = api_client.get(f'{API}/market/activity', headers=_auth_header(outsider['token']), params={'board': 'tools'}, timeout=20)
        assert any(row['id'] == request_id and row['phone'] == '+919812345678' for row in owner_activity.json())
        owner_phone = next(row['phone'] for row in renter_activity.json() if row['id'] == request_id)
        assert owner_phone == '+919876543210'
        assert all(row['listing_id'] != listing_id for row in outsider_activity.json())

        outsider_detail = api_client.get(
            f'{API}/market/listings/{listing_id}', headers=_auth_header(outsider['token']), timeout=20
        )
        assert outsider_detail.status_code == 200
        assert outsider_detail.json()['phone'] is None

        # Inclusive date total snapshot: 3 days (d3..d5) * 2500
        renter_row = next(row for row in renter_activity.json() if row['id'] == request_id)
        assert renter_row['total'] == 7500

    def test_cancel_and_atomic_overlap_conflict(self, api_client, seeded_users):
        owner, renter, outsider = seeded_users[0], seeded_users[1], seeded_users[2]
        listing = self._create_tool_listing(api_client, owner['token'], f'atomic-{uuid.uuid4().hex[:6]}')
        listing_id = listing['id']

        req_a = api_client.post(
            f'{API}/market/listings/{listing_id}/requests',
            headers=_auth_header(renter['token']),
            json={'phone': '+919811112222', 'message': 'TEST A', 'start_date': _iso_day(4), 'end_date': _iso_day(6)},
            timeout=20,
        )
        assert req_a.status_code == 200
        req_a_id = req_a.json()['my_request']['id']

        req_b = api_client.post(
            f'{API}/market/listings/{listing_id}/requests',
            headers=_auth_header(outsider['token']),
            json={'phone': '+919833334444', 'message': 'TEST B', 'start_date': _iso_day(5), 'end_date': _iso_day(7)},
            timeout=20,
        )
        assert req_b.status_code == 200
        req_b_id = req_b.json()['my_request']['id']

        # Simulated concurrent accepts (same owner, overlapping windows): one should succeed, one must 409.
        accept_a = requests.patch(
            f'{API}/market/listings/{listing_id}/requests/{req_a_id}',
            headers={**_auth_header(owner['token']), 'Content-Type': 'application/json'},
            json={'status': 'accepted'},
            timeout=20,
        )
        accept_b = requests.patch(
            f'{API}/market/listings/{listing_id}/requests/{req_b_id}',
            headers={**_auth_header(owner['token']), 'Content-Type': 'application/json'},
            json={'status': 'accepted'},
            timeout=20,
        )
        assert {accept_a.status_code, accept_b.status_code} == {200, 409}

        accepted_id = req_a_id if accept_a.status_code == 200 else req_b_id
        pending_id = req_b_id if accepted_id == req_a_id else req_a_id

        retry_overlap = api_client.patch(
            f'{API}/market/listings/{listing_id}/requests/{pending_id}',
            headers=_auth_header(owner['token']),
            json={'status': 'accepted'},
            timeout=20,
        )
        assert retry_overlap.status_code == 409

        cancel_accepted_by_sender = api_client.patch(
            f'{API}/market/listings/{listing_id}/requests/{accepted_id}',
            headers=_auth_header(renter['token'] if accepted_id == req_a_id else outsider['token']),
            json={'status': 'cancelled'},
            timeout=20,
        )
        assert cancel_accepted_by_sender.status_code == 200

    def test_work_board_interest_and_closed_excluded(self, api_client, seeded_users):
        owner, renter = seeded_users[0], seeded_users[1]

        job = api_client.post(
            f'{API}/market/listings',
            headers=_auth_header(owner['token']),
            json={
                'kind': 'job',
                'title': f'TEST Harvest help {uuid.uuid4().hex[:6]}',
                'category': 'harvest',
                'description': 'TEST need 4 workers for onion harvest and bag loading.',
                'daily_rate': 900,
                'location_name': 'Nashik, Maharashtra',
                'latitude': 19.9975,
                'longitude': 73.7898,
                'phone': '+919900001111',
                'start_date': _iso_day(2),
                'end_date': _iso_day(5),
                'people': 4,
            },
            timeout=20,
        )
        assert job.status_code == 201
        job_id = job.json()['id']

        worker = api_client.post(
            f'{API}/market/listings',
            headers=_auth_header(renter['token']),
            json={
                'kind': 'worker',
                'title': f'TEST Worker team {uuid.uuid4().hex[:6]}',
                'category': 'harvest',
                'description': 'TEST worker team available for cutting and loading tasks.',
                'daily_rate': 850,
                'location_name': 'Nashik, Maharashtra',
                'latitude': 19.9975,
                'longitude': 73.7898,
                'phone': '+919922223333',
                'start_date': _iso_day(2),
                'end_date': _iso_day(6),
                'people': 3,
            },
            timeout=20,
        )
        assert worker.status_code == 201
        worker_id = worker.json()['id']

        owner_interest_worker = api_client.post(
            f'{API}/market/listings/{worker_id}/requests',
            headers=_auth_header(owner['token']),
            json={'phone': '+919955556666', 'message': 'TEST interested', 'start_date': _iso_day(2), 'end_date': _iso_day(3)},
            timeout=20,
        )
        assert owner_interest_worker.status_code == 200
        worker_req_id = owner_interest_worker.json()['my_request']['id']

        renter_interest_job = api_client.post(
            f'{API}/market/listings/{job_id}/requests',
            headers=_auth_header(renter['token']),
            json={'phone': '+919922223333', 'message': 'TEST we can do it', 'start_date': _iso_day(2), 'end_date': _iso_day(4)},
            timeout=20,
        )
        assert renter_interest_job.status_code == 200
        job_req_id = renter_interest_job.json()['my_request']['id']

        accept_worker = api_client.patch(
            f'{API}/market/listings/{worker_id}/requests/{worker_req_id}',
            headers=_auth_header(renter['token']),
            json={'status': 'accepted'},
            timeout=20,
        )
        assert accept_worker.status_code == 200

        decline_job = api_client.patch(
            f'{API}/market/listings/{job_id}/requests/{job_req_id}',
            headers=_auth_header(owner['token']),
            json={'status': 'declined'},
            timeout=20,
        )
        assert decline_job.status_code == 200

        owner_activity = api_client.get(
            f'{API}/market/activity', headers=_auth_header(owner['token']), params={'board': 'work'}, timeout=20
        )
        renter_activity = api_client.get(
            f'{API}/market/activity', headers=_auth_header(renter['token']), params={'board': 'work'}, timeout=20
        )
        assert any(item['id'] == worker_req_id for item in owner_activity.json())
        assert any(item['id'] == job_req_id for item in renter_activity.json())

        close_job = api_client.patch(
            f'{API}/market/listings/{job_id}', headers=_auth_header(owner['token']), json={'status': 'closed'}, timeout=20
        )
        assert close_job.status_code == 200

        nearby_work = api_client.get(
            f'{API}/market/listings',
            headers=_auth_header(owner['token']),
            params={'board': 'work', 'radius': 25, 'latitude': 19.9975, 'longitude': 73.7898},
            timeout=20,
        )
        assert nearby_work.status_code == 200
        assert all(item['id'] != job_id for item in nearby_work.json())
