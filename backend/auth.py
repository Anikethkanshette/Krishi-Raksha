import asyncio
import hashlib
import uuid
from datetime import timedelta

import requests
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument

from database import db, utc_now

router = APIRouter(prefix='/api/auth', tags=['accounts'])


class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: str = ''


class Exchange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    session_id: str = Field(min_length=1, max_length=2048)


class SessionResponse(BaseModel):
    session_token: str
    user: User


def bearer(authorization):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Please sign in with Google.')
    return authorization[7:]


async def current_user(authorization: str | None = Header(default=None)) -> User:
    token = bearer(authorization)
    session = await db.user_sessions.find_one({'session_token': token}, {'_id': 0})
    if not session or session['expires_at'] <= utc_now():
        raise HTTPException(401, 'Your session has expired. Please sign in again.')
    user = await db.users.find_one({'user_id': session['user_id']}, {'_id': 0})
    if not user:
        raise HTTPException(401, 'Account not found. Please sign in again.')
    return User(**user)


@router.post('/session', response_model=SessionResponse)
async def exchange_session(body: Exchange):
    # A unique digest prevents duplicate exchange across workers without storing the callback secret.
    digest = hashlib.sha256(body.session_id.encode()).hexdigest()
    claim = await db.auth_exchanges.update_one(
        {'id': digest}, {'$setOnInsert': {'expires_at': utc_now() + timedelta(minutes=15)}}, upsert=True,
    )
    if not claim.upserted_id:
        raise HTTPException(401, 'This sign-in link was already used. Please sign in again.')
    try:
        response = await asyncio.to_thread(
            requests.get, 'https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data',
            headers={'X-Session-ID': body.session_id}, timeout=15,
        )
        if response.status_code != 200:
            raise HTTPException(401, 'Google sign-in expired or was cancelled. Please try again.')
        data = response.json()
        if not data.get('email') or not data.get('session_token'):
            raise HTTPException(401, 'Google did not return a valid account.')
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(503, 'Sign-in is temporarily unavailable. Please try again.') from exc
    now = utc_now()
    user = await db.users.find_one_and_update(
        {'email': data['email'].strip().lower()},
        {'$set': {'name': data.get('name') or 'Farmer', 'picture': data.get('picture') or ''},
         '$setOnInsert': {'user_id': f'user_{uuid.uuid4().hex}', 'created_at': now}},
        upsert=True, return_document=ReturnDocument.AFTER, projection={'_id': 0},
    )
    token = data['session_token']
    await db.user_sessions.update_one(
        {'session_token': token},
        {'$set': {'user_id': user['user_id'], 'expires_at': now + timedelta(days=7), 'created_at': now}},
        upsert=True,
    )
    return SessionResponse(session_token=token, user=User(**user))


@router.get('/me', response_model=User)
async def me(user: User = Depends(current_user)):
    return user


@router.post('/logout')
async def logout(authorization: str | None = Header(default=None)):
    await db.user_sessions.delete_one({'session_token': bearer(authorization)})
    return {'ok': True}


async def ensure_auth_indexes():
    await db.users.create_index('email', unique=True)
    await db.users.create_index('user_id', unique=True)
    await db.user_sessions.create_index('session_token', unique=True)
    await db.user_sessions.create_index('user_id')
    await db.user_sessions.create_index('expires_at', expireAfterSeconds=0)
    await db.auth_exchanges.create_index('id', unique=True)
    await db.auth_exchanges.create_index('expires_at', expireAfterSeconds=0)