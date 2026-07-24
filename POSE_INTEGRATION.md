# Finishing on-device pose (M2)

The app is fully functional today on a **mock pose source** (`src/pose/usePoseSource.ts`),
so every screen, the rep/form engine, the replay, and history can be built and
demoed on a simulator. This doc is the checklist to swap in **real camera pose**
on a Dev Client build — the one part that cannot be validated without a physical
device (camera + GPU delegate).

## Why it isn't wired yet

`expo install` pulled **react-native-vision-camera 5.1.0**, a Nitro-based rewrite
that (a) ships **no Expo config plugin** and (b) replaced the classic
`useFrameProcessor` API with a new frame-output pipeline. Camera/mic permissions
are therefore set manually in `app.json` (`ios.infoPlist.NS*UsageDescription`,
`android.permissions`) instead of via the plugin.

### Decision: pin VisionCamera, then wire frames

You have two supported routes. Pick one before writing the frame processor:

1. **Stable & battle-tested — VisionCamera 4 + fast-tflite + Skia (recommended).**
   `npx expo install react-native-vision-camera@^4` . v4 has the config plugin
   (add `"react-native-vision-camera"` back to `plugins`) and the well-documented
   `useFrameProcessor` + `react-native-fast-tflite` + Skia pose pipeline
   (mrousavy.com/blog/VisionCamera-Pose-Detection-TFLite). Uses **MoveNet** →
   `decodeMoveNet()` already maps its 17 keypoints into our 33-landmark model.

2. **Richest data — MediaPipe Pose Landmarker (33 landmarks + 3D).** Use a
   MediaPipe RN plugin (e.g. a Pose Landmarker package) that emits landmarks via
   an event listener; feed those straight into `SessionEngine.push()`. Best form
   accuracy; less mature tooling.

## Wiring steps (route 1)

1. Add the model: put `movenet.tflite` in `assets/models/` (see its README).
2. In `src/camera/useCameraPose.ts`, load it:
   `const model = useTensorflowModel(require('@/assets/models/movenet.tflite'), 'core-ml')`
   and add a `declare module '*.tflite'` ambient type (or use `metro` asset ext).
3. Add a frame processor that, per frame: resizes to the model input (use
   `vision-camera-resize-plugin`), runs `model.model.runSync([tensor])`, calls
   `decodeMoveNet(output)`, and posts the `Landmark[]` to JS via a `runOnJS`
   bridge.
4. In `src/app/workout/active.tsx`, render `<Camera … frameProcessor={…} />`
   behind the HUD, switch `usePoseSource` to `mode: 'camera'`, and route the
   bridged landmarks into the same `onFrame` used by the mock source.
5. **Recording for replay (M5):** start `camera.startRecording()` on begin, stop
   on finish, and pass the resulting file URI as `videoUri` into the finished
   session (the review screen already prefers video over the skeleton replay).

## Verify on device

- `eas build --profile development --platform ios` (or android), install, open.
- Grant camera + mic. Confirm the skeleton tracks you live; do 5 slow squats and
  check the rep count matches and "Chest up" fires on a deliberate forward lean.
- Confirm Stop → replay plays your video with the form report.
