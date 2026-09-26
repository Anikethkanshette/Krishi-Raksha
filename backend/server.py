from __future__ import annotations

import asyncio
import base64
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

import requests
from dotenv import load_dotenv
from emergentintegrations.llm.chat import ImageContent, LlmChat, TextDelta, UserMessage
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from auth import User, current_user, ensure_auth_indexes, router as auth_router
from database import client, db
from locations import router as location_router
from marketplace import ensure_market_indexes, router as market_router

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

app = FastAPI(title="Krushi Raksha API")
api_router = APIRouter(prefix="/api")
logger = logging.getLogger("krushi-raksha")

DEFAULT_LOCATION = {"name": "Nashik, Maharashtra", "latitude": 20.0059, "longitude": 73.7910}
OFFICIAL_712_URL = "https://bhulekh.mahabhumi.gov.in/"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Crop(BaseModel):
    id: str
    name: str
    name_mr: str
    variety: str
    area_acres: float
    health_score: Optional[int] = None
    ndvi: Optional[float] = None
    next_action: str
    next_action_mr: str
    created_at: str


class DiaryEntry(BaseModel):
    id: str
    crop_id: str
    crop_name: str
    activity_type: str
    title: str
    title_mr: str
    notes: str = ""
    amount: Optional[float] = None
    created_at: str


class DiaryEntryCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)
    crop_id: str = "manual"
    crop_name: str = Field(default="Crop", min_length=1, max_length=80)
    activity_type: str = Field(pattern="^(irrigation|fertilizer|spray|expense|harvest)$")
    title: str = Field(min_length=1, max_length=150)
    title_mr: str = ""
    notes: str = Field(default="", max_length=3000)
    amount: Optional[float] = Field(default=None, ge=0, le=100000000)


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", pattern="^(en|mr)$")


class AssistantMessage(BaseModel):
    id: str
    role: str
    content: str
    created_at: str


class DownloadLogCreate(BaseModel):
    district: str
    taluka: str
    village: str
    survey_number: str


async def ensure_indexes() -> None:
    await db.crops.create_index("id", unique=True)
    await db.diary.create_index("id", unique=True)
    await db.assistant_messages.create_index("id", unique=True)
    await db.land_record_downloads.create_index("id", unique=True)
    for collection in ['crops', 'diary', 'diagnoses', 'assistant_turns', 'land_record_downloads']:
        await db[collection].create_index('user_id')
    await db.assistant_turns.create_index('id', unique=True)
    await db.diagnoses.create_index('id', unique=True)


class CropCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=80)
    variety: str = Field(default='', max_length=80)
    area_acres: float = Field(gt=0, le=100000)


@api_router.post('/crops', response_model=Crop)
async def add_crop(body: CropCreate, user: User = Depends(current_user)):
    crop = Crop(id=str(uuid.uuid4()), name=body.name, name_mr=body.name, variety=body.variety,
                area_acres=body.area_acres, next_action='Check new growth and record field observations.',
                next_action_mr='नवीन वाढ तपासा आणि शेतातील निरीक्षणे नोंदवा.', created_at=utc_now().isoformat())
    await db.crops.insert_one({**crop.model_dump(), 'user_id': user.user_id})
    return crop


async def fetch_weather(latitude: float, longitude: float) -> dict[str, Any]:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
        "hourly": "precipitation_probability,soil_moisture_0_to_1cm",
        "forecast_days": 2,
        "timezone": "auto",
    }
    try:
        response = await asyncio.to_thread(
            requests.get, "https://api.open-meteo.com/v1/forecast", params=params, timeout=7
        )
        response.raise_for_status()
        payload = response.json()
        current = payload.get("current", {})
        hourly = payload.get("hourly", {})
        hour_index = next((i for i, time in enumerate(hourly.get('time', [])) if time[:13] == current.get('time', '')[:13]), 0)
        rain_values = hourly.get("precipitation_probability", [])[hour_index:hour_index + 12]
        moisture_values = hourly.get("soil_moisture_0_to_1cm", [])[hour_index:]
        return {
            "available": True,
            "temperature_c": round(float(current.get("temperature_2m", 0)), 1),
            "humidity": int(current.get("relative_humidity_2m", 0)),
            "precipitation_mm": round(float(current.get("precipitation", 0)), 1),
            "rain_probability": int(max(rain_values[:12] or [0])),
            "soil_moisture": round(float(moisture_values[0] * 100), 0) if moisture_values else 0,
            "wind_kmh": round(float(current.get("wind_speed_10m", 0)), 1),
            "weather_code": current.get("weather_code", 0),
        }
    except (requests.RequestException, ValueError, TypeError) as exc:
        logger.warning("Weather service unavailable: %s", exc)
        return {"available": False, "message": "Weather is temporarily unavailable."}


def build_risks(weather: dict[str, Any], crops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    rain_probability = int(weather.get("rain_probability", 0))
    if rain_probability >= 60:
        risks.append(
            {
                "id": "rain-risk",
                "severity": "medium",
                "title": "Rain window ahead",
                "title_mr": "पावसाची शक्यता",
                "description": "Rain is possible in the next 12 hours. Check the forecast before spraying.",
                "description_mr": "पुढील १२ तासांत पाऊस शक्य आहे. फवारणीपूर्वी अंदाज तपासा.",
            }
        )
    for crop in crops:
        if crop.get("health_score") is not None and crop['health_score'] < 75:
            risks.append(
                {
                    "id": f"health-{crop['id']}",
                    "severity": "high",
                    "title": f"{crop['name']} needs a field check",
                    "title_mr": f"{crop.get('name_mr', crop['name'])} तपासा",
                    "description": crop.get("next_action", "Inspect the crop today."),
                    "description_mr": crop.get("next_action_mr", "आज पिकाची पाहणी करा."),
                }
            )
    if not risks:
        risks.append(
            {
                "id": "scout-weekly",
                "severity": "low",
                "title": "Weekly crop scout is due",
                "title_mr": "साप्ताहिक पिक पाहणी बाकी",
                "description": "Walk the field edges and check new growth.",
                "description_mr": "शेताच्या कडेने फेरफटका मारून नवीन वाढ तपासा.",
            }
        )
    return risks


async def run_gemini(prompt: str, session_id: str, image_base64: Optional[str] = None) -> str:
    key = os.getenv("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="AI service is not configured.")
    chat = LlmChat(
        api_key=key,
        session_id=session_id,
        system_message=(
            "You are Krushi Raksha, a careful agricultural advisor for farmers in Maharashtra. "
            "Answer in the requested language, be practical and concise, and never claim certainty "
            "from a photo alone. Recommend consulting a local agronomist for dangerous crop loss."
        ),
    ).with_model("gemini", "gemini-3-flash-preview")
    contents = [ImageContent(image_base64=image_base64)] if image_base64 else None
    chunks: list[str] = []
    async for event in chat.stream_message(UserMessage(text=prompt, file_contents=contents or [])):
        if isinstance(event, TextDelta):
            chunks.append(event.content)
    return "".join(chunks).strip()


@api_router.get("/")
async def root() -> dict[str, str]:
    return {"message": "Krushi Raksha API is running"}


@api_router.get("/dashboard")
async def dashboard(latitude: float = Query(default=DEFAULT_LOCATION["latitude"], ge=-90, le=90), longitude: float = Query(default=DEFAULT_LOCATION["longitude"], ge=-180, le=180), user: User = Depends(current_user)):
    crops = await db.crops.find({'user_id': user.user_id}, {"_id": 0, 'user_id': 0}).sort("created_at", -1).to_list(20)
    weather = await fetch_weather(latitude, longitude)
    return {
        "location": {"name": DEFAULT_LOCATION["name"], "latitude": latitude, "longitude": longitude},
        "weather": weather,
        "crops": crops,
        "risks": build_risks(weather, crops),
        "last_synced": utc_now().isoformat(),
    }


@api_router.get("/crops", response_model=List[Crop])
async def get_crops(user: User = Depends(current_user)) -> list[Crop]:
    crops = await db.crops.find({'user_id': user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [Crop(**crop) for crop in crops]


@api_router.get("/diary", response_model=List[DiaryEntry])
async def get_diary(user: User = Depends(current_user)) -> list[DiaryEntry]:
    entries = await db.diary.find({'user_id': user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [DiaryEntry(**entry) for entry in entries]


@api_router.post("/diary", response_model=DiaryEntry)
async def create_diary_entry(input: DiaryEntryCreate, user: User = Depends(current_user)) -> DiaryEntry:
    entry = DiaryEntry(id=str(uuid.uuid4()), created_at=utc_now().isoformat(), **input.model_dump())
    await db.diary.insert_one({**entry.model_dump(), 'user_id': user.user_id})
    return entry


@api_router.delete('/diary/{entry_id}')
async def delete_diary(entry_id: str, user: User = Depends(current_user)):
    result = await db.diary.delete_one({'id': entry_id, 'user_id': user.user_id})
    if not result.deleted_count:
        raise HTTPException(404, 'Entry not found.')
    return {'ok': True}


@api_router.post("/diagnosis")
async def diagnose_crop(
    crop_name: str = Form("Soybean"),
    symptoms: str = Form("No symptoms entered"),
    language: str = Form("en"),
    image: UploadFile = File(...),
    user: User = Depends(current_user),
):
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Please upload a JPEG, PNG, or WEBP crop photo.")
    image_bytes = await image.read(8 * 1024 * 1024 + 1)
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Please choose an image smaller than 8 MB.")
    prompt = (
        f"Analyze this {crop_name} crop photo. Farmer symptoms: {symptoms}. "
        f"Reply in {'Marathi' if language == 'mr' else 'English'} with exactly these short sections: "
        "Likely issue, Confidence, What to do today, What to monitor, Safety note. "
        "Do not invent a chemical dosage."
    )
    result = await run_gemini(
        prompt,
        session_id=f"diagnosis-{uuid.uuid4()}",
        image_base64=base64.b64encode(image_bytes).decode("ascii"),
    )
    diagnosis = {
        "id": str(uuid.uuid4()),
        "crop_name": crop_name,
        "symptoms": symptoms,
        "result": result,
        "created_at": utc_now().isoformat(),
    }
    await db.diagnoses.insert_one({**diagnosis, 'user_id': user.user_id})
    return diagnosis


@api_router.get("/diagnoses")
async def get_diagnoses(user: User = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.diagnoses.find({'user_id': user.user_id}, {"_id": 0, 'user_id': 0}).sort("created_at", -1).to_list(20)


@api_router.post("/assistant", response_model=AssistantMessage)
async def assistant(input: AssistantRequest, user: User = Depends(current_user)) -> AssistantMessage:
    if not input.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    language_name = "Marathi" if input.language == "mr" else "English"
    turns = await db.assistant_turns.find({'user_id': user.user_id}, {'_id': 0}).sort('created_at', -1).to_list(5)
    history = '\n'.join(f"Farmer: {turn['messages'][0]['content']}\nAdvisor: {turn['messages'][1]['content']}" for turn in reversed(turns))
    response = await run_gemini(
        f"Answer in {language_name}. Use plain text, not Markdown. Prior conversation:\n{history}\nFarmer question: {input.message.strip()}",
        session_id=f"assistant-{uuid.uuid4()}",
    )
    user_message = AssistantMessage(id=str(uuid.uuid4()), role="user", content=input.message, created_at=utc_now().isoformat())
    ai_message = AssistantMessage(id=str(uuid.uuid4()), role="assistant", content=response, created_at=utc_now().isoformat())
    await db.assistant_turns.insert_one({'id': str(uuid.uuid4()), 'user_id': user.user_id,
                                      'created_at': utc_now().isoformat(),
                                      'messages': [user_message.model_dump(), ai_message.model_dump()]})
    return ai_message


@api_router.get("/assistant/history", response_model=List[AssistantMessage])
async def assistant_history(user: User = Depends(current_user)) -> list[AssistantMessage]:
    turns = await db.assistant_turns.find({'user_id': user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [AssistantMessage(**message) for turn in reversed(turns) for message in turn['messages']]


@api_router.get("/land-records")
async def land_records() -> dict[str, Any]:
    return {
        "official_url": OFFICIAL_712_URL,
        "steps": [
            {"number": 1, "title": "Select district", "title_mr": "जिल्हा निवडा"},
            {"number": 2, "title": "Select taluka and village", "title_mr": "तालुका आणि गाव निवडा"},
            {"number": 3, "title": "Enter Survey / Gat number", "title_mr": "सर्वे / गट क्रमांक भरा"},
            {"number": 4, "title": "Complete the portal verification", "title_mr": "पोर्टलवरील पडताळणी पूर्ण करा"},
            {"number": 5, "title": "View record; follow digital-signature service for certified copies", "title_mr": "उतारा पाहा; प्रमाणित प्रतीसाठी डिजिटल स्वाक्षरी सेवा वापरा"},
        ],
    }


@api_router.post("/land-records/log-download")
async def log_land_record_download(input: DownloadLogCreate, user: User = Depends(current_user)) -> dict[str, Any]:
    record = {
        "id": str(uuid.uuid4()),
        **input.model_dump(),
        "official_url": OFFICIAL_712_URL,
        "created_at": utc_now().isoformat(),
    }
    await db.land_record_downloads.insert_one({**record, 'user_id': user.user_id})
    return record


app.include_router(api_router)
app.include_router(auth_router)
app.include_router(location_router)
app.include_router(market_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_db() -> None:
    await ensure_indexes()
    await ensure_auth_indexes()
    await ensure_market_indexes()


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    client.close()