from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient


def main() -> None:
    load_dotenv('/app/backend/.env')
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME')
    if not mongo_url or not db_name:
        raise RuntimeError('MONGO_URL/DB_NAME missing')

    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=6)

    owner = {
        'user_id': 'TEST_user_ui_owner',
        'email': 'test.ui.owner@example.com',
        'name': 'TEST UI Owner',
        'picture': '',
    }
    other = {
        'user_id': 'TEST_user_ui_other',
        'email': 'test.ui.other@example.com',
        'name': 'TEST UI Other',
        'picture': '',
    }

    owner_token = f"ui_owner_{secrets.token_hex(16)}"
    other_token = f"ui_other_{secrets.token_hex(16)}"

    client = MongoClient(mongo_url)
    db = client[db_name]
    try:
        for user in (owner, other):
            db.users.update_one(
                {'user_id': user['user_id']},
                {'$set': {**user, 'created_at': now}},
                upsert=True,
            )

        db.user_sessions.insert_many(
            [
                {
                    'session_token': owner_token,
                    'user_id': owner['user_id'],
                    'created_at': now,
                    'expires_at': expires,
                },
                {
                    'session_token': other_token,
                    'user_id': other['user_id'],
                    'created_at': now,
                    'expires_at': expires,
                },
            ]
        )

        payload = {
            'owner': {'user_id': owner['user_id'], 'email': owner['email'], 'token': owner_token},
            'other': {'user_id': other['user_id'], 'email': other['email'], 'token': other_token},
        }
        Path('/tmp/ui_sessions_iter3.json').write_text(json.dumps(payload), encoding='utf-8')
        print('/tmp/ui_sessions_iter3.json')
    finally:
        client.close()


if __name__ == '__main__':
    main()