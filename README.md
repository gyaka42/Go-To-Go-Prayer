# Go-To-Go-Prayer

## Diyanet Official API

To use Diyanet as prayer-time provider, set these environment variables before starting Expo:

- `EXPO_PUBLIC_DIYANET_USERNAME`
- `EXPO_PUBLIC_DIYANET_PASSWORD`
- Optional: `EXPO_PUBLIC_DIYANET_CITY_ID` (fallback only; used only when geo-city resolution fails)
- Optional: `EXPO_PUBLIC_DIYANET_FORCE_CITY_ID` (temporary debug override; forces a specific city id)

If your username/password contains special characters (like `#`), keep the value in quotes in `.env`.

Example:

```bash
cp .env.example .env
# edit .env with your real credentials
EXPO_PUBLIC_DIYANET_USERNAME="your_email"
EXPO_PUBLIC_DIYANET_PASSWORD="your_password"
EXPO_PUBLIC_DIYANET_CITY_ID="539"
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
