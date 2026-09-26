import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo import ReturnDocument

from auth import User, current_user
from database import db, utc_now

router = APIRouter(prefix='/api/market', tags=['local marketplace'])
Kind = Literal['tool', 'job', 'worker']
TOOL_CATEGORIES = {'tractor', 'sprayer', 'harvester', 'tiller', 'other'}
WORK_CATEGORIES = {'sowing', 'harvest', 'spraying', 'irrigation', 'general'}


def india_today():
    return datetime.now(timezone(timedelta(hours=5, minutes=30))).date()


class ListingInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False, extra='forbid')
    kind: Kind
    title: str = Field(min_length=3, max_length=100)
    category: str
    description: str = Field(min_length=10, max_length=2000)
    daily_rate: float = Field(gt=0, le=1000000)
    location_name: str = Field(min_length=2, max_length=150)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    phone: str = Field(pattern=r'^\+?[0-9]{10,13}$')
    start_date: date
    end_date: date
    people: int = Field(default=1, ge=1, le=100)

    @model_validator(mode='after')
    def validate_listing(self):
        if self.category not in (TOOL_CATEGORIES if self.kind == 'tool' else WORK_CATEGORIES):
            raise ValueError('Choose a valid category.')
        if self.start_date < india_today() or self.end_date < self.start_date:
            raise ValueError('Choose current or future dates in the correct order.')
        if (self.end_date - self.start_date).days > 366:
            raise ValueError('Availability must be within one year.')
        return self


class RequestInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    phone: str = Field(pattern=r'^\+?[0-9]{10,13}$')
    message: str = Field(default='', max_length=500)
    start_date: date
    end_date: date

    @model_validator(mode='after')
    def validate_dates(self):
        if self.start_date < india_today() or self.end_date < self.start_date:
            raise ValueError('Choose current or future dates in the correct order.')
        return self


class ListingOut(BaseModel):
    id: str
    kind: Kind
    title: str
    category: str
    description: str
    daily_rate: float
    location_name: str
    start_date: str
    end_date: str
    people: int
    owner_name: str
    status: str
    created_at: str
    is_owner: bool
    distance_km: float | None = None
    request_count: int = 0
    my_request: dict | None = None
    phone: str | None = None


class ActivityOut(BaseModel):
    id: str
    listing_id: str
    title: str
    kind: Kind
    incoming: bool
    other_name: str
    status: str
    start_date: str
    end_date: str
    total: float
    message: str
    phone: str | None = None
    created_at: str


def public_listing(doc, user):
    own = doc['owner_id'] == user.user_id
    mine = next((r for r in reversed(doc.get('requests', [])) if r['user_id'] == user.user_id), None)
    # Never expose other users' requests, email, phone, or exact coordinates in the feed.
    fields = {k: v for k, v in doc.items() if k in ListingOut.model_fields and k != 'phone'}
    fields.update(is_owner=own, distance_km=round(doc['distance'] / 1000, 1) if 'distance' in doc else None,
                  request_count=len([r for r in doc.get('requests', []) if r['status'] in {'pending', 'accepted'}]),
                  my_request={k: v for k, v in mine.items() if k not in {'user_id', 'phone'}} if mine else None,
                  phone=doc['phone'] if own or (mine and mine['status'] == 'accepted') else None)
    return ListingOut(**fields)


@router.post('/listings', response_model=ListingOut, status_code=201)
async def create_listing(body: ListingInput, user: User = Depends(current_user)):
    doc = body.model_dump(mode='json', exclude={'latitude', 'longitude'})
    doc.update(id=str(uuid.uuid4()), owner_id=user.user_id, owner_name=user.name, status='open', requests=[],
               created_at=utc_now().isoformat(),
               geo={'type': 'Point', 'coordinates': [round(body.longitude, 2), round(body.latitude, 2)]})
    await db.listings.insert_one(doc.copy())
    return public_listing(doc, user)


@router.get('/listings', response_model=list[ListingOut])
async def list_listings(
    board: Literal['tools', 'work'] = 'tools', kind: Kind | None = None,
    latitude: float = Query(default=20.0059, ge=-90, le=90),
    longitude: float = Query(default=73.791, ge=-180, le=180),
    radius: int = Query(default=25, ge=1, le=200), q: str = Query(default='', max_length=80),
    category: str = '', mine: bool = False, user: User = Depends(current_user),
):
    query: dict = {'kind': 'tool' if board == 'tools' else {'$in': ['job', 'worker']}}
    if kind and board == 'work' and kind != 'tool':
        query['kind'] = kind
    if category:
        query['category'] = category
    if q.strip():
        query['$or'] = [{'title': {'$regex': re.escape(q.strip()), '$options': 'i'}},
                        {'description': {'$regex': re.escape(q.strip()), '$options': 'i'}}]
    if mine:
        query['owner_id'] = user.user_id
        docs = await db.listings.find(query, {'_id': 0}).sort('created_at', -1).to_list(100)
    else:
        query.update(status='open', end_date={'$gte': india_today().isoformat()})
        docs = await db.listings.aggregate([
            {'$geoNear': {'near': {'type': 'Point', 'coordinates': [longitude, latitude]}, 'distanceField': 'distance',
                          'maxDistance': radius * 1000, 'spherical': True, 'query': query}},
            {'$limit': 100}, {'$project': {'_id': 0}},
        ]).to_list(100)
    return [public_listing(d, user) for d in docs]


@router.get('/listings/{listing_id}', response_model=ListingOut)
async def listing_detail(listing_id: str, user: User = Depends(current_user)):
    doc = await db.listings.find_one({'id': listing_id}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Listing not found.')
    return public_listing(doc, user)


class ListingStatus(BaseModel):
    status: Literal['open', 'closed']


@router.patch('/listings/{listing_id}', response_model=ListingOut)
async def change_listing(listing_id: str, body: ListingStatus, user: User = Depends(current_user)):
    doc = await db.listings.find_one_and_update(
        {'id': listing_id, 'owner_id': user.user_id}, {'$set': {'status': body.status}},
        return_document=ReturnDocument.AFTER, projection={'_id': 0},
    )
    if not doc:
        raise HTTPException(404, 'Your listing was not found.')
    return public_listing(doc, user)


@router.post('/listings/{listing_id}/requests', response_model=ListingOut)
async def request_listing(listing_id: str, body: RequestInput, user: User = Depends(current_user)):
    doc = await db.listings.find_one({'id': listing_id}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Listing not found.')
    if doc['owner_id'] == user.user_id:
        raise HTTPException(400, 'You cannot respond to your own listing.')
    start, end = body.start_date.isoformat(), body.end_date.isoformat()
    if start < doc['start_date'] or end > doc['end_date']:
        raise HTTPException(422, 'Requested dates must fall within the listed availability.')
    request = {**body.model_dump(mode='json'), 'id': str(uuid.uuid4()), 'user_id': user.user_id,
               'name': user.name, 'status': 'pending', 'created_at': utc_now().isoformat(),
               'daily_rate': doc['daily_rate'], 'total': round(((body.end_date - body.start_date).days + 1) * doc['daily_rate'], 2)}
    updated = await db.listings.find_one_and_update(
        {'id': listing_id, 'status': 'open', 'end_date': {'$gte': india_today().isoformat()},
         'requests': {'$not': {'$elemMatch': {'user_id': user.user_id, 'status': {'$in': ['pending', 'accepted']}}}},
         'requests.99': {'$exists': False}},
        {'$push': {'requests': request}}, projection={'_id': 0}, return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(409, 'Listing closed, response already active, or response limit reached.')
    return public_listing(updated, user)


@router.get('/activity', response_model=list[ActivityOut])
async def activity(board: Literal['tools', 'work'] = 'tools', user: User = Depends(current_user)):
    docs = await db.listings.find(
        {'kind': 'tool' if board == 'tools' else {'$in': ['job', 'worker']},
         '$or': [{'owner_id': user.user_id}, {'requests.user_id': user.user_id}]}, {'_id': 0},
    ).to_list(500)
    result = []
    for doc in docs:
        incoming = doc['owner_id'] == user.user_id
        for r in doc.get('requests', []):
            if incoming or r['user_id'] == user.user_id:
                result.append(ActivityOut(
                    id=r['id'], listing_id=doc['id'], title=doc['title'], kind=doc['kind'], incoming=incoming,
                    other_name=r['name'] if incoming else doc['owner_name'], status=r['status'],
                    start_date=r['start_date'], end_date=r['end_date'], total=r['total'], message=r['message'],
                    phone=(r['phone'] if incoming else doc['phone']) if r['status'] == 'accepted' else None,
                    created_at=r['created_at'],
                ))
    return sorted(result, key=lambda r: r.created_at, reverse=True)


class Decision(BaseModel):
    status: Literal['accepted', 'declined', 'cancelled']


@router.patch('/listings/{listing_id}/requests/{request_id}', response_model=ListingOut)
async def decide_request(listing_id: str, request_id: str, body: Decision, user: User = Depends(current_user)):
    doc = await db.listings.find_one({'id': listing_id}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Listing not found.')
    target = next((r for r in doc.get('requests', []) if r['id'] == request_id), None)
    if not target:
        raise HTTPException(404, 'Response not found.')
    owner = doc['owner_id'] == user.user_id
    if body.status == 'cancelled':
        if target['user_id'] != user.user_id:
            raise HTTPException(403, 'Only the sender can cancel this response.')
        expected = ['pending', 'accepted']
    else:
        if not owner:
            raise HTTPException(403, 'Only the listing owner can accept or decline.')
        expected = ['pending']
    query = {'id': listing_id, 'requests': {'$elemMatch': {'id': request_id, 'status': {'$in': expected}}}}
    if body.status == 'accepted':
        if target['end_date'] < india_today().isoformat():
            raise HTTPException(409, 'These dates have passed.')
        query['status'] = 'open'
        if doc['kind'] == 'tool':
            query['$and'] = [{'requests': {'$not': {'$elemMatch': {
                'status': 'accepted', 'start_date': {'$lte': target['end_date']}, 'end_date': {'$gte': target['start_date']},
            }}}}]
    # Availability conflict check and status transition are ONE atomic document write.
    updated = await db.listings.find_one_and_update(
        query, {'$set': {'requests.$[r].status': body.status}},
        array_filters=[{'r.id': request_id}], projection={'_id': 0}, return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(409, 'Response changed, listing closed, or these rental dates are already booked.')
    return public_listing(updated, user)


async def ensure_market_indexes():
    await db.listings.create_index('id', unique=True)
    await db.listings.create_index([('geo', '2dsphere')])
    await db.listings.create_index('owner_id')
    await db.listings.create_index('requests.user_id')