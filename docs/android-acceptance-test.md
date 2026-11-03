# Android acceptance test — GoToGo Prayer

Use this checklist on a physical Android phone before promoting the next closed-test build.

## Build identity

- Install the candidate from the **Alpha closed-test Play link**, not from the old local `app-release.apk`.
- In Play Console, verify that the candidate version code is **higher than 7**.
- Record the installed app version and version code in the result table below.

## 1. Alert settings and Android notification channels

1. Open Fajr alert settings.
2. Confirm that Android shows **no volume slider**.
3. Confirm that the explanation says Android loudness is controlled by notification volume and the app's notification-channel settings.
4. Allow notification permission when requested.
5. Run **Test notification** for each combination below and wait for the notification itself. The test must not vibrate before the notification appears.

| Tone | Sound | Vibration | Expected |
| --- | --- | --- | --- |
| Beep | On | On | Default sound and vibration |
| Adhan | On | On | Adhan sound and vibration |
| Beep | On | Off | Default sound, no vibration |
| Beep | Off | On | No sound, vibration |
| Beep | Off | Off | Visible notification, no sound or vibration |

Repeat at least the Adhan/on/on combination:

- while the app is in the background;
- after swiping the app away from Recents;
- with the screen locked;
- once after restarting the phone.

Also open Android **Settings > Apps > GoToGo Prayer > Notifications**. Check that the prayer-alert channels are enabled and that the phone's notification volume is audible. Android users can override channel sound and vibration here, so record any override.

## 2. Qibla layout and live compass

1. Open Qibla in portrait mode.
2. Confirm that the degree badge is below the circular compass and never covers **S**.
3. Repeat on a small emulator profile (about 320 dp wide), the physical phone, and a larger phone/tablet profile.
4. On the physical phone, move it in a figure-eight to calibrate it, then hold it flat and away from metal, magnets and speakers.
5. Rotate the phone slowly through a full circle. The compass and turn-left/turn-right guidance must respond continuously.
6. Compare the indicated Qibla direction with a trusted reference at the same location. Record the approximate difference in degrees.
7. Confirm that the status becomes live/reliable after calibration. An emulator showing fallback/questionable is not a failure by itself.

## 3. Data retention

Create recognizable test values:

- Zikr: set a counter to 17 and a non-default target.
- Qaza: add at least one item and change the goal.
- Favorites: add one mosque and one content favorite.
- Settings: change one prayer reminder and one location/timing setting, then press Save.

Verify the same values after:

1. navigating to another screen and back;
2. putting the app in the background for one minute;
3. swiping the app away and reopening it;
4. restarting the phone and reopening it.

Do not clear app storage or uninstall between these checks; Android correctly removes local app data in those cases.

## Result record

| Item | Result | Evidence / notes |
| --- | --- | --- |
| App version and version code |  |  |
| Android alert text/slider |  |  |
| Sound matrix |  |  |
| Locked-screen/background reminder |  |  |
| Qibla badge layout |  |  |
| Live compass and calibration |  |  |
| Zikr retained |  |  |
| Qaza retained |  |  |
| Favorites retained |  |  |
| Settings retained |  |  |
