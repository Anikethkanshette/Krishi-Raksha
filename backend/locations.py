import asyncio
import time
from typing import Literal

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict

from auth import User, current_user
from database import db

router = APIRouter(prefix='/api', tags=['location'])
cache: dict = {}


class FarmLocation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=150)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    source: Literal['gps', 'manual']
    accuracy: float | None = Field(default=None, ge=0)


@router.get('/location', response_model=FarmLocation | None)
async def get_location(user: User = Depends(current_user)):
    doc = await db.users.find_one({'user_id': user.user_id}, {'_id': 0, 'location': 1})
    return doc.get('location') if doc else None


@router.put('/location', response_model=FarmLocation)
async def save_location(body: FarmLocation, user: User = Depends(current_user)):
    await db.users.update_one({'user_id': user.user_id}, {'$set': {'location': body.model_dump()}})
    return body


@router.get('/locations/search')
async def search_locations(q: str = Query(min_length=2, max_length=80), user: User = Depends(current_user)):
    key = q.strip().lower()
    if len(key) < 2:
        raise HTTPException(422, 'Enter at least two letters.')
    if key in cache and time.monotonic() - cache[key][0] < 300:
        return cache[key][1]
    try:
        response = await asyncio.to_thread(
            requests.get, 'https://geocoding-api.open-meteo.com/v1/search',
            params={'name': q.strip(), 'countryCode': 'IN', 'language': 'en', 'count': 20, 'format': 'json'}, timeout=8,
        )
        response.raise_for_status()
        places = [{'id': str(p['id']), 'name': ', '.join(dict.fromkeys(filter(None, [p['name'], p.get('admin2'), p.get('admin1')]))),
                   'latitude': p['latitude'], 'longitude': p['longitude'], 'source': 'manual'}
                  for p in response.json().get('results', []) if p.get('country_code') == 'IN']
        places.sort(key=lambda p: 'Maharashtra' not in p['name'])
        if len(cache) > 500:
            cache.clear()
        cache[key] = (time.monotonic(), places[:10])
        return places[:10]
    except (requests.RequestException, ValueError, KeyError) as exc:
        raise HTTPException(503, 'Location search is unavailable. Use GPS or try again.') from exc