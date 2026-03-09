# Diyanet Proxy (Railway)

## Environment variables

- `DIYANET_USERNAME`
- `DIYANET_PASSWORD`
- `DIYANET_QURAN_API_KEY`
- `DIYANET_QURAN_API_BASE_URL` (optional, default: `https://api.diyanet.gov.tr`)
- `QURAN_CACHE_TTL_MS` (optional, default: 86400000)

## Local run

```bash
cd backend/diyanet-proxy
npm install
DIYANET_USERNAME="your_email" DIYANET_PASSWORD="your_password" npm start
```

## Endpoints

- `GET /health`
- `GET /timings?lat=52.3676&lon=4.9041&date=12-02-2026`
- Optional query params: `city`, `country`, `countryCode`, `cityId`
- `GET /quran/surahs?lang=tr`
- `GET /quran/surahs/:surahId?lang=tr&translation=tr`
- `GET /quran/ayah/:verseKey?lang=tr&translation=tr`
- `GET /quran/audio/:surahId?lang=tr&reciter=<id>`
