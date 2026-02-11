# Diyanet Proxy (Railway)

## Environment variables

- `DIYANET_USERNAME`
- `DIYANET_PASSWORD`

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
