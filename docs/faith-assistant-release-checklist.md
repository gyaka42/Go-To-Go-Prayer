# Faith Assistant V1: beta and release checklist

Use this checklist for the first TestFlight and App Store release of the Faith Assistant. Keep secrets in
Railway and Groq only. Never place them in Git, Expo public variables, screenshots, build logs, or chat.

## 1. Release gate before deployment

- [ ] `cd backend/diyanet-proxy && npm test` passes all multilingual evaluation and safety tests.
- [ ] `npm run typecheck` passes.
- [ ] `npm run release:check` passes and reports version `1.0.6`, build `62` or a later build.
- [ ] `npx expo export --platform ios` completes successfully.
- [ ] The privacy policy containing the Faith Assistant section is publicly reachable.
- [ ] App Store Connect privacy answers have been reviewed for the new app version, including third-party
      processing. Free-form questions are `Other User Content`; the app-generated installation identifier
      must also be assessed under Apple's identifier definitions.
- [ ] Groq Data Controls have been reviewed. Enable Zero Data Retention before public release and record the
      date it was verified. Do not claim ZDR is active until the Groq console confirms it.

## 2. Railway configuration

Keep one Railway instance for V1 because rate-limit counters live in process memory. Configure these variables
directly in the Railway service:

| Variable | Release value |
| --- | --- |
| `GROQ_API_KEY` | A server-only Groq API key |
| `FAITH_RATE_LIMIT_SECRET` | A separate random value of at least 32 characters |
| `FAITH_ASSISTANT_ENABLED` | `false` for the first deployment, then `true` after staged checks |
| `GROQ_MODEL` | `openai/gpt-oss-120b` unless a tested replacement is selected |
| `FAITH_INSTALL_MINUTE_LIMIT` | `4` |
| `FAITH_INSTALL_DAILY_LIMIT` | `10` |
| `FAITH_IP_MINUTE_LIMIT` | `8` |
| `FAITH_IP_DAILY_LIMIT` | `60` |
| `FAITH_GLOBAL_MINUTE_LIMIT` | `25` |
| `FAITH_GLOBAL_DAILY_LIMIT` | `800` |

Generate the rate-limit secret locally with `openssl rand -hex 32` and enter it directly in Railway. It must
not be the same value as the Groq API key.

## 3. Staged backend deployment

1. Push the backend commit while `FAITH_ASSISTANT_ENABLED=false`.
2. Wait for Railway to finish deploying.
3. Confirm `GET /health` returns `200` and includes a `faithAssistant` section.
4. Confirm `GET /faith/health` returns `200`, `enabled=false`, and `ready=false`:

   ```bash
   FAITH_SMOKE_EXPECT_READY=false npm run faith:smoke
   ```

5. Set `FAITH_ASSISTANT_ENABLED=true` in Railway and redeploy.
6. Run the quota-free production smoke test:

   ```bash
   npm run faith:smoke
   ```

7. Run the live provider check once. This sends three source-backed questions, one per supported language,
   and therefore uses three Groq requests:

   ```bash
   FAITH_SMOKE_LIVE=true npm run faith:smoke
   ```

The smoke test fails on a missing endpoint, disabled configuration, unapproved citation, wrong route,
missing quota metadata, or an answer that is not supported by the deployed source registry.

## 4. TestFlight beta matrix

Test at least one compact iPhone and one larger iPhone, in light and dark mode. Repeat the key answer flow in
English, Dutch, and Turkish.

- [ ] The Menu opens the Faith Assistant and the availability banner becomes ready.
- [ ] General Sunni and Hanafi can be selected, remain visually clear, and are saved with each history item.
- [ ] A supported source-backed question returns a concise answer, the correct perspective, and at least one
      tappable Diyanet citation.
- [ ] The example Hanafi travel/combine question never presents a general-only source as Hanafi.
- [ ] Prayer-time and qibla questions direct the user to the app's deterministic tools without consuming the
      daily AI allowance.
- [ ] An unrelated question returns an out-of-scope message without a citation.
- [ ] A personal-fatwa or divorce question returns a referral and does not produce a ruling.
- [ ] Safety-boundary text is clear in all three languages. Do not use real personal details in beta prompts.
- [ ] The privacy warning is visible before submission and no question is sent until the user taps submit.
- [ ] Remaining daily allowance and UTC reset information are understandable in all three languages.
- [ ] The last 20 questions are stored only on the device; one item and the full history can both be deleted.
- [ ] Citation links open correctly, and a link-opening failure shows a localized error.
- [ ] Offline mode, timeout, provider failure, daily limit, and burst limit show localized retry guidance.
- [ ] Existing prayer times, notifications, widgets, Qibla, monthly overview, Quran, Zikr, and Qaza flows still
      work after the backend deploy and TestFlight update.

For rate-limit UI testing, temporarily lower limits only in a private staging deployment. Do not change
production limits merely to force an error during public testing.

## 5. App Store release and rollback

- [ ] Upload a build whose `CFBundleShortVersionString` matches the open App Store train and whose build number
      is higher than every build already uploaded for that version.
- [ ] Update App Store description, What's New, screenshots, review notes, privacy policy URL, and app privacy
      answers before submission.
- [ ] In App Review notes, state that the assistant provides educational answers with reviewed-source and clearly labelled general-AI modes, does not give
      personalised fatwas, and requires a network connection.
- [ ] Run the safe production smoke test again immediately before submission and after release.

Emergency rollback does not require a new app build: set `FAITH_ASSISTANT_ENABLED=false` in Railway. The app
will show the localized unavailable state while all non-AI features continue working.
