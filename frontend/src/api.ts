import Constants from "expo-constants";
import { Platform } from 'react-native';

const configuredUrl =
  Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL;
const API_URL = `${String(configuredUrl || "").replace(/\/$/, "")}/api`;

export type Weather = {
  available: boolean;
  temperature_c?: number;
  humidity?: number;
  rain_probability?: number;
  soil_moisture?: number;
  wind_kmh?: number;
  message?: string;
};

export type Crop = {
  id: string;
  name: string;
  name_mr: string;
  variety: string;
  area_acres: number;
  health_score: number | null;
  ndvi: number | null;
  next_action: string;
  next_action_mr: string;
};

export type Risk = {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  title_mr: string;
  description: string;
  description_mr: string;
};

export type Dashboard = {
  location: { name: string; latitude: number; longitude: number };
  weather: Weather;
  crops: Crop[];
  risks: Risk[];
  last_synced: string;
};

export type DiaryEntry = {
  id: string;
  crop_id: string;
  crop_name: string;
  activity_type: "irrigation" | "fertilizer" | "spray" | "expense" | "harvest";
  title: string;
  title_mr: string;
  notes: string;
  amount?: number;
  created_at: string;
};

export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string };

let sessionToken = '';
let unauthorized: (() => void) | null = null;
export function configureSession(token: string, handler?: () => void) {
  sessionToken = token;
  if (handler) unauthorized = handler;
}
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = sessionToken;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers,
  }});
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && token && token === sessionToken) unauthorized?.();
    const detail = Array.isArray(body.detail) ? body.detail.map((e: {msg: string}) => e.msg.replace('Value error, ', '')).join('\n') : body.detail;
    throw new Error(detail || "Something went wrong. Please try again.");
  }
  return response.json() as Promise<T>;
}

export function getDashboard(latitude?: number, longitude?: number) {
  const query = latitude !== undefined && longitude !== undefined ? `?latitude=${latitude}&longitude=${longitude}` : "";
  return request<Dashboard>(`/dashboard${query}`);
}

export function getDiary() {
  return request<DiaryEntry[]>("/diary");
}

export function createDiary(input: Omit<DiaryEntry, "id" | "created_at">) {
  return request<DiaryEntry>("/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export function getAssistantHistory() {
  return request<AssistantMessage[]>("/assistant/history");
}

export function sendAssistant(message: string, language: string) {
  return request<AssistantMessage>("/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, language }) });
}

export function getLandRecords() {
  return request<{ official_url: string; steps: { number: number; title: string; title_mr: string }[] }>("/land-records");
}

export function logDownload(input: { district: string; taluka: string; village: string; survey_number: string }) {
  return request("/land-records/log-download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export async function diagnose(uri: string, cropName: string, symptoms: string, language: string) {
  const body = new FormData();
  body.append("crop_name", cropName);
  body.append("symptoms", symptoms || "No symptoms entered");
  body.append("language", language);
  if (Platform.OS === 'web') {
    const blob = await fetch(uri).then((response) => response.blob());
    body.append("image", blob, "crop-photo.jpg");
  } else {
    body.append("image", { uri, name: "crop-photo.jpg", type: "image/jpeg" } as unknown as Blob);
  }
  return request<{ id: string; crop_name: string; result: string; created_at: string }>("/diagnosis", { method: "POST", body });
}