# Go-To-Go-Prayer

## Diyanet Official API.

The app now uses a server-side proxy (Cloudflare Worker) for Diyanet.
Do not put Diyanet username/password in the mobile app.

Set this environment variable before starting Expo:

- `EXPO_PUBLIC_DIYANET_PROXY_URL` (example: `https://your-worker.workers.dev`)
- Optional: `EXPO_PUBLIC_DIYANET_FORCE_CITY_ID` (temporary debug override; forces a specific city id)

## Railway Proxy Option

This repo includes a Railway-ready backend at `backend/diyanet-proxy`.

- Root directory: `backend/diyanet-proxy`
- Start command: `npm start`
- Required env vars on Railway:
  - `DIYANET_USERNAME`
  - `DIYANET_PASSWORD`

Use your Railway domain as `EXPO_PUBLIC_DIYANET_PROXY_URL`.

Example:

```bash
cp .env.example .env
# edit .env with your Worker URL
EXPO_PUBLIC_DIYANET_PROXY_URL="https://your-worker.workers.dev"
# EXPO_PUBLIC_DIYANET_FORCE_CITY_ID="13976"
npm run start
```

Then in the app:

1. Open `Settings`
2. Open `Calculation Method`
3. Select `Diyanet Official API`

## Timings Cache Behavior

- The app stores prayer times for a 30-day window per location/provider/method.
- Normal app start uses cached location + cached timings (no immediate GPS call).
- Pull-to-refresh and the home refresh button force GPS + refresh the 30-day cache window.
