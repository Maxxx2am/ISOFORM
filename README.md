# ISO-FORM

Offline-first calisthenics coach. Live on-device pose tracking draws a skeleton
on your body while you train, counts reps, calls out form faults, and on Stop
replays your set with plain-language feedback. Minimalist true-black "isometric"
design. Everything stays on the phone — no account, no network.

## Status

- ✅ **M0** Project setup, native deps, Dev Client / EAS config
- ✅ **M1** Design system (true-black + selectable accent) + tab navigation
- ✅ **M2** Skeleton overlay (Skia) — *runs on a mock pose source; real camera is the on-device finishing step, see [POSE_INTEGRATION.md](./POSE_INTEGRATION.md)*
- ✅ **M3** Active workout screen + circular timer
- ✅ **M4** Rep counting + form engine (squat, push-up, plank, lunge, glute bridge)
- ✅ **M5** Replay + form report (video-aware; skeleton replay today)
- ✅ **M6** Exercise library ("Learn")
- ✅ **M7** Workout history (SQLite)
- ✅ **M8** Settings (accent, coaching toggles)
- ⏳ **M9** Performance pass (after real camera is wired)

The whole flow is exercisable **today on a simulator** via the synthetic pose
source (`src/pose/mockPose.ts`) — pick an exercise, watch the skeleton squat, see
reps/cues, Stop, review the report. Swapping in the real camera is the one step
that needs a physical device.

## Run it

### Free QR preview in Expo Go (works today, no build)

The storage + skeleton overlay use Expo-Go-friendly libraries (AsyncStorage +
react-native-svg), and the camera runs on a **mock pose source**, so the whole
UI runs in the free Expo Go app:

```powershell
npx expo start
# Then scan the QR:
#  - Android: open Expo Go → Scan QR code
#  - iOS: open the Camera app → point at the QR → tap the Expo Go banner
# If your phone can't connect (different network / firewall):
npx expo start --tunnel
```

You get Train, Learn, the live mock-skeleton workout (timer, reps, form cues),
Set Review, History, and Settings. The **real camera** is the only thing Expo Go
can't do — that needs a Dev Client (below).

> PowerShell 5.1 has no `&&` — chain commands with `;` or use separate lines.

### Real camera (Dev Client)

`react-native-vision-camera` is native and not in Expo Go — wire it on a Dev
Client build (see [POSE_INTEGRATION.md](./POSE_INTEGRATION.md)):

```powershell
# Windows can't build iOS locally (needs a Mac) — use EAS cloud:
npx eas build --profile development --platform ios
# Android locally (needs Android Studio + SDK + device/emulator):
npx expo run:android
```

## Architecture

```
Camera frames ─▶ pose model ─▶ Landmark[] ─▶ SkeletonOverlay (Skia)
                                    └────────▶ SessionEngine
                                                 ├─ RepCounter (angle state machine)
                                                 ├─ FormAnalyzer (debounced cues)
                                                 └─ timeline (for replay)
Stop ─▶ SessionSummary ─▶ review screen + SQLite history
```

- `src/theme/` — true-black palette, accents, typography, `useTheme`
- `src/pose/` — landmark model, Skia overlay, mock source (real camera in `src/camera/`)
- `src/engine/` — geometry, rep counter, form analyzer, session engine (pure TS)
- `src/exercises/` — data-driven exercise definitions (angles + form rules)
- `src/store/` — zustand (settings persisted via MMKV, session handoff)
- `src/storage/` — MMKV key-value + SQLite history
- `src/app/` — expo-router routes (tabs + workout + exercise detail)

## Notes

- Runs on **Expo SDK 54** (RN 0.81.5, React 19.1.0) to match the Expo Go client.
- Skia and MMKV were swapped for react-native-svg + AsyncStorage so the app runs
  in Expo Go. VisionCamera / fast-tflite are not installed yet — add them when
  wiring the real camera on a Dev Client. See [POSE_INTEGRATION.md](./POSE_INTEGRATION.md)
  (VisionCamera 4 recommended for the documented frame-processor pose pipeline).
