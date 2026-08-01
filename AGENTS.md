# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Architecture Overview

ISOFORM is a React Native (Expo) bodyweight fitness tracker. It uses pose detection (MediaPipe via custom HTML/WebView) to count reps and track form.

### Key Directories

| Path | Purpose |
|------|---------|
| `src/app/` | Expo Router file-based routes (tabs, workout flow, legal) |
| `src/components/` | Shared UI components (ExerciseTracker, RepGauge, SkeletonOverlay, etc.) |
| `src/engine/` | Rep counting & session analysis (SessionEngine, RepCounter, AdaptiveRepCounter) |
| `src/exercises/` | Exercise definitions (data.ts), types (types.ts), built-in templates, remote config registry |
| `src/lib/` | Utilities: insights, ranks, coach, formatting, dev tools, global error handler |
| `src/pose/` | Pose tracking types, stability, mock source, HTML analysis overlays |
| `src/store/` | Zustand stores: settings, profile, subscription, workouts, sessions, drafts |
| `src/storage/` | AsyncStorage adapter (kv.ts), SQLite database (db.ts) |
| `src/theme/` | Theme palette, useTheme hook |
| `exercises.json` | Remote exercise config manifest (repo root — fetched at runtime) |

### How the Remote Update System Works (exercises.json)

This is the "push-to-GitHub-to-update-the-app" system:

1. `src/app/_layout.tsx` calls `startAutoRefresh()` after first render (deferred via InteractionManager)
2. `src/exercises/registry.ts` fetches `exercises.json` from GitHub's raw URL:
   `https://raw.githubusercontent.com/Maxxx2am/ISOFORM/master/exercises.json`
3. The JSON contains:
   - `version` (number): bump every time you change anything
   - `changelog` (array): shown in Settings → Content Updates widget
   - `overrides` (object): patches exercise thresholds at runtime — no rebuild needed
4. Registry calls `setActiveExercises()` (from `data.ts`) to swap in the merged list
5. Settings widget shows a green dot when `remoteVersion > lastSeenVersion`

**To publish an update (no build required):**
- Edit `exercises.json` — bump `version`, add a changelog entry, patch overrides
- Git commit & push to `master`
- Users see the update on next app launch (auto-fetch) or manual refresh in Settings

**To add a new exercise:**
1. Add the `def({...})` entry to the `EXERCISES` array in `src/exercises/data.ts`
2. If it's in a built-in template, add it to `src/exercises/builtinTemplates.ts`
3. Optionally add it to `exercises.json` overrides for future remote threshold tweaks
4. Bump `exercises.json` version + add a changelog entry

**Format for exercises.json overrides:**
```json
{
  "pushup": {
    "rep": { "downBelow": 110, "upAbove": 148 },
    "gauge": { "downBelow": 110, "upAbove": 148 }
  }
}
```
Rep exercises get `rep` + `gauge`. Hold exercises get `hold` + `gauge`. The `gauge` field requires a compiled gauge in `data.ts` — it patches existing fields, it doesn't create them.

### Pending Before Next Publish

- **iCloud sync** — iCloud row was removed from Settings (broken/not implemented). To add it back:
  1. Enable iCloud capability in Apple Developer portal for `com.maxxxdev.isoform`
  2. Implement NSUbiquitousKeyValueStore + CloudKit sync (use `db.ts` `insertIfMissing()` as merge target)
  3. Add `com.apple.developer.icloud-services` to `app.json` entitlements
  4. Regenerate provisioning profile
  5. The old implementation was in a deleted `src/lib/icloudSync.ts` — check git history @ commit `d4fa0ee`

### Known Exercise Tracking Gaps

### Database Notes

- SQLite via `expo-sqlite` — sessions table with migrations for added columns
- migrations use `try/catch` checking for "duplicate column" errors only
- `saveSession()` returns `boolean` (true = success, false = failure) — callers check this

### Important Conventions

- All exercise `id` === exercise `slug` (set in `def()` helper, data.ts:575)
- Expo Router auto-generates routes for ALL files in `src/app/` — explicit `<Stack.Screen>` only needed for special options
- Zustand stores use AsyncStorage for persistence (`zustandKvStorage`)
- The session engine determines adaptive rep counting by `exercise.slug === 'pushup'`, NOT by any exercise property
- `expo-file-system` is imported from `/legacy` path (uses `cacheDirectory`)

### Common Pitfalls

- Never define an exercise in templates that doesn't exist in `data.ts` EXERCISES
- Always bump `exercises.json` version when adding changelog entries
- Gauge overrides in `exercises.json` only work if the exercise has a compiled `gauge` field
- Don't forget `bodyPart` on form rules — missing it means no skeleton highlighting
- `expo-updates` is installed at the native layer but NOT wired in JS — no OTA updates yet
