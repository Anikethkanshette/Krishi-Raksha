# Krushi Raksha — Product & implementation record

## Goal and confirmed choices
Mobile-only Marathi/English farming app for Maharashtra: live weather, crop records and risks, Gemini crop-photo diagnosis and farming assistant, private crop diary, official 7/12 guidance. Latest request adds Emergent-managed Google sign-in, precise GPS, professional redesign, peer-to-peer equipment rentals (daily rate + request), farmer hiring and worker availability together on one work board.

- Fully per-user crops, diary, AI history, diagnoses and location.
- Publicly published listings visible to authenticated local members; ownership, incoming/outgoing requests and contacts access-controlled.
- High-accuracy foreground GPS by default for new accounts, with manual village/city search fallback. No background tracking.
- User delegated a completely new professional style. Architectural emerald, harvest gold, editorial farm photography; five normal-flow tabs.
- Rental/payment terms arranged directly. No in-app money collection or guaranteed bookings. Requests require owner acceptance.

## Architecture
- Expo package.json is source of truth: SDK 57, React Native 0.86. Expo Router root AuthProvider gate. Do not downgrade or change metro.config.js.
- FastAPI /api prefix, MongoDB Motor connection from protected MONGO_URL/DB_NAME, timezone-aware datetimes. Backend 8001.
- Backend modules: database.py, auth.py, locations.py, marketplace.py, server.py (weather, private farm records, Gemini, land guide).
- Frontend: app/index.tsx shell; src/auth.tsx; src/location.tsx; src/screens/{Welcome,Home,Market,MarketForms,Diary,Assistant,FarmSheets}; src/components/DateField.tsx; src/ui.tsx; src/theme.ts; api.ts/local-api.ts.
- Native token storage through storage.secure* (SecureStore) with shared krushi_session key. Browser preview uses existing platform storage adapter. Login state nonce stored separately. One-time OAuth callbacks deduplicated frontend and backend. Local sessions expire after 7 days and are revoked on logout. All API requests use Bearer header.
- Root gate unmounts all private screens at logout; user-keyed stack prevents old account state reuse.

## Implemented in latest iteration
- Managed Google OAuth browser handoff, native auth-session + hot/cold deep links, state validation, backend exchange, user upsert, TTL sessions, /auth/me and /auth/logout.
- Ownership enforced on every private data query/write. Old shared, unowned records preserved but NOT assigned to new accounts.
- Precise GPS with 18s position timeout, native city-level reverse labels, permission error + Settings action, debounced manual Open-Meteo/GeoNames search and explicit selected coordinates. Per-user saved location.
- New professional welcome/dashboard/tabs, safe-area handling, keyboard-friendly forms, native calendar components, loading/error/empty states, English/Marathi text.
- Real empty marketplaces (no invented listings), nearby distance search 10/25/50 km, keyword/category and worker/job filters, My listings, private Requests.
- Publish equipment, hiring or worker availability with daily rate, dates, people count, area and contact; close/reopen listings.
- Rental requests or job interest with chosen dates and cost/wage estimate. Atomic accept/decline/cancel; accepted equipment rental periods cannot overlap. Contacts shared only after acceptance. Request deduplication and bounded embedded response arrays.
- Private diary create/read/delete with crop entry and expenses; private AI conversation history with recent-turn context; each chat turn saved atomically as one document.
- Add personal crop records without invented health/NDVI readings. Weather-based risk cues and existing AI diagnosis retained.
- 7/12 official browser handoff and local talathi alternative guidance. No direct authenticated government retrieval/certification claimed.

## Data integrity and privacy
- Unique user IDs, emails, session tokens, record/listing IDs; TTL sessions and OAuth replay digests; owner/query scoping.
- Single-document atomic MongoDB updates for listing + embedded requests including availability check and transition in one operation. No multi-document transaction guarantee on standalone MongoDB.
- Listing geo-coordinates rounded to ~village level; exact account GPS not returned in listing feed. No participant details exposed to unrelated accounts. Provider credentials backend environment only.
- Diagnostic images processed transiently by existing Gemini path, not persisted in MongoDB or diary. Generated welcome farm image hosted on managed image storage. Equipment listing photos are not part of this iteration.

## Integrations
- Emergent-managed Google Auth — no customer credentials needed; provider exchange occurs only backend.
- Gemini via existing emergentintegrations and server-only EMERGENT_LLM_KEY; gemini-3-flash-preview retained.
- Open-Meteo forecast and keyless geocoder; GeoNames coverage may omit small villages, UI suggests searching nearby town.
- Expo Location, ImagePicker, WebBrowser, Linking, Crypto, SecureStore.

## Verification
- Python and JavaScript lint pass. TypeScript compile passes after SDK typing adjustments.
- Public mobile preview welcome rendered at 390×844; English/Marathi toggle and managed sign-in handoff verified.
- Manual backend checks: signed-out private diary HTTP 401; invalid OAuth session callback HTTP 401.
- Backend iteration 2: 11/11 regression tests pass, including auth errors/revocation, ownership, nearby filters, duplicate requests, role/ownership checks, overlapping rental rejection, both directions of work responses.
- Iteration 2 found empty-string conditional JSX warnings. Guards changed to boolean checks across all screens. Iteration 3 mistakenly cited historical Expo log entries for this warning; its fresh browser console contained no text-node error. Later fresh main-agent browser runs also confirm no text-node errors.
- Iteration 3 identified a real shared Sheet overflow issue. Fixed sheet flex/height bounds and inner ScrollView constraints; removed blanket LogBox suppression.
- Main-agent verification at 390×844 and 375×667: manual Pune search, tool form/calendar/day selection/publish, second-user rental request, owner accept/contact sharing, renter cancellation, owner close/reopen, farmer hiring post, worker availability post, interest in both directions and decline, private crop create, diary save with empty notes/delete, actual Gemini assistant reply with normal send tap, official portal opening, signout-to-welcome. See test_reports/manual_verification.md.
- Full Google consent/real provider callback and iOS/Android physical-device return/GPS still need user verification; authenticated browser tests use synthetic DB session fixtures, not a Google-login bypass in the product.
- Secret scan of frontend and memory found no backend secret values.
- Final backend rerun passed 11/11. A test-only parallel fixture cleanup race was corrected by assigning each pytest worker its own synthetic identities; application auth code was unchanged.
- All temporary synthetic accounts, sessions and owned test records removed after verification. Latest browser console logs have no errors; Expo restarted for final preview.

## Priorities
- P0: No known blocker remaining in tested application flows. Physical-device/real Google verification remains a user action, not a completed automated test.
- P1: User verifies actual Google account consent/return on device and precise GPS permissions.
- P1: Richer listing edit flow and rental photos with managed object storage; notifications for new requests.
- P2: Listing moderation/reporting, crop trends, richer forecasting, authorized government record API if available.