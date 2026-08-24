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
- `GROQ_MODEL` (optional, default: `openai/gpt-oss-20b`)
- `GROQ_API_BASE_URL` (optional, default: `https://api.groq.com/openai/v1`)
- `GROQ_TIMEOUT_MS` (optional, default: `15000`, clamped to 3000-30000)
- `GROQ_MAX_COMPLETION_TOKENS` (optional, default: `700`, clamped to 128-1600)
- `FAITH_ASSISTANT_ENABLED` (optional, default: `false`)

The Faith Assistant is fail-closed. It classifies questions locally, retrieves only manually reviewed
passages from runtime-approved sources, and allows Groq to cite only server-controlled passage IDs.
Questions without matching evidence return `insufficient_sources` without calling Groq.
Keep `FAITH_ASSISTANT_ENABLED=false` on the public Railway deployment until the privacy,
per-installation limit and abuse-protection step is complete.

## Local run

```bash
cd backend/diyanet-proxy
npm install
DIYANET_USERNAME="your_email" DIYANET_PASSWORD="your_password" npm start
```

## Endpoints

- `GET /health`
- `GET /faith/health` (public status only; never returns secrets)
- `POST /faith/ask` with JSON `{ "question": "...", "language": "en|nl|tr", "perspective": "general_sunni|hanafi" }`
- `GET /timings?lat=52.3676&lon=4.9041&date=12-02-2026`
- Optional query params: `city`, `country`, `countryCode`, `cityId`
- `GET /quran/surahs?lang=tr`
- `GET /quran/surahs/:surahId?lang=tr&translation=tr`
- `GET /quran/ayah/:verseKey?lang=tr&translation=tr`
- `GET /quran/audio/:surahId?lang=tr&reciter=<id>`
