# Pose model

`pose_landmarker_lite.task` — MediaPipe Pose Landmarker (Lite, float16),
fetched from Google's model garden
(`storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/`),
~5.8 MB, zip-bundle (`PK`) verified. Apache-2.0, free forever.

It is NOT bundled through Metro — the `react-native-mediapipe-posedetection`
Expo config plugin (see `app.json`) copies every file in this folder into the
native projects at prebuild (iOS bundle resources / `android/.../assets`),
excluding files matching `ignoredPattern` (this README). The runtime loads it
by filename: see `MODEL_FILE` in `src/camera/useCameraPose.ts`.

Want more accuracy at some speed cost? Swap in `pose_landmarker_full.task`
(same URL pattern, `pose_landmarker_full`) and update `MODEL_FILE` — same
33-landmark output, drop-in. A native rebuild (EAS) is required after any
model file change; Metro reload is not enough.
