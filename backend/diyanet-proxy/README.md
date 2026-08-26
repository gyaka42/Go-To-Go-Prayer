# Diyanet Proxy (Railway)

## Environment variables

- `DIYANET_USERNAME`
- `DIYANET_PASSWORD`
- `DIYANET_QURAN_API_KEY`
- `DIYANET_QURAN_API_BASE_URL` (optional, default: `https://api.diyanet.gov.tr`)
- `QURAN_CACHE_TTL_MS` (optional, default: 86400000)
- `QURAN_AUDIO_FALLBACK_ENABLED` (optional, default: `true`)
- `QURAN_AUDIO_FALLBACK_RECITER` (optional, default: `ar.alafasy`)
- `QURAN_AUDIO_FALLBACK_BITRATE` (optional, default: `128`)
- `GROQ_API_KEY` (server-only; never add this to the Expo app or an `EXPO_PUBLIC_` variable)
- `GROQ_MODEL` (optional, default: `openai/gpt-oss-120b`)
- `GROQ_API_BASE_URL` (optional, default: `https://api.groq.com/openai/v1`)
- `GROQ_TIMEOUT_MS` (optional, default: `15000`, clamped to 3000-30000)
- `GROQ_MAX_COMPLETION_TOKENS` (optional, default: `1600`, clamped to 128-2400)
- `FAITH_RATE_LIMIT_SECRET` (required when enabled; a separate random secret of at least 32 characters)
- `FAITH_INSTALL_MINUTE_LIMIT` (optional, default: `4`, maximum: `30`)
- `FAITH_INSTALL_DAILY_LIMIT` (optional, default: `10`, maximum: `100`)
- `FAITH_IP_MINUTE_LIMIT` (optional, default: `8`, maximum: `120`)
- `FAITH_IP_DAILY_LIMIT` (optional, default: `60`, maximum: `500`)
- `FAITH_GLOBAL_MINUTE_LIMIT` (optional, default: `25`, maximum: `30`)
- `FAITH_GLOBAL_DAILY_LIMIT` (optional, default: `800`, maximum: `1000`)
- `FAITH_ASSISTANT_ENABLED` (optional, default: `false`)

The Faith Assistant is fail-closed. It classifies questions locally, retrieves only manually reviewed
passages from runtime-approved sources, and allows Groq to cite only server-controlled passage IDs.
Questions without matching evidence return `insufficient_sources` without calling Groq.
The backend does not persist questions, generated answers, raw installation IDs, or IP addresses.
Rate-limit keys are HMAC hashes and their counters expire in memory at the end of the minute or UTC day.
Only requests that reach Groq consume the daily AI allowance; locally rejected or unsupported questions do not.

The limiter is intended for one Railway application instance. A restart clears its counters, and multiple
instances do not share counters. Keep a single instance for V1; use a shared store before scaling horizontally.
Groq's account-level limits remain the final provider backstop. Before public release, review Groq's current
data controls and enable Zero Data Retention for the project if the account is eligible.

Generate a dedicated rate-limit secret with `openssl rand -hex 32`. Never add either backend secret to the app,
source control, logs, public health output, or an `EXPO_PUBLIC_` variable.

## Local run

```bash
cd backend/diyanet-proxy
npm install
DIYANET_USERNAME="your_email" DIYANET_PASSWORD="your_password" npm start
```

## Faith Assistant evaluation

Run `npm test` in this directory before deploying. The suite includes the versioned EN/NL/TR evaluation
corpus in `faith-evals/v1-cases.json`, source-registry checks, prompt-injection isolation, fail-closed
citation checks, privacy/rate-limit checks, and provider error handling. The evaluation suite uses a mock
Groq client and does not consume provider quota.

## Faith Assistant deployment checks

Deploy first with `FAITH_ASSISTANT_ENABLED=false`, then verify that the new endpoint is present:

```bash
FAITH_SMOKE_EXPECT_READY=false npm run faith:smoke
```

After setting the Railway feature flag to `true`, run the safe production check. It validates the EN/NL/TR
local routes and does not call Groq:

```bash
npm run faith:smoke
```

Run the live provider check once before TestFlight release. It uses three Groq requests:

```bash
FAITH_SMOKE_LIVE=true npm run faith:smoke
```

The commands above are run from the repository root. See `docs/faith-assistant-release-checklist.md` for the
complete Railway, privacy, TestFlight, App Store, and rollback checklist.

## Endpoints

- `GET /health`
- `GET /faith/health` (public status only; never returns secrets)
- `POST /faith/ask` with JSON `{ "question": "...", "language": "en|nl|tr", "perspective": "general_sunni|hanafi", "installationId": "anonymous-stable-id" }`

Successful Faith Assistant responses include `rateLimit` with the installation's daily `limit`, `remaining`,
and UTC `resetAt`. A `429` response includes `retryAfterSeconds` and the `Retry-After` header.
- `GET /timings?lat=52.3676&lon=4.9041&date=12-02-2026`
- Optional query params: `city`, `country`, `countryCode`, `cityId`
- `GET /quran/surahs?lang=tr`
- `GET /quran/surahs/:surahId?lang=tr&translation=tr`
- `GET /quran/ayah/:verseKey?lang=tr&translation=tr`
- `GET /quran/audio/:surahId?lang=tr&reciter=<id>`
