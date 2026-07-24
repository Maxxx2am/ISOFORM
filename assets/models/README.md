# Pose models

Drop the on-device pose model here.

- **MoveNet Thunder (int8) `.tflite`** — turnkey default. Input `1×256×256×3` uint8,
  output `1×1×17×3` float32 `[y, x, score]`. Get it from TensorFlow Hub / Kaggle
  Models ("movenet/singlepose/thunder"), save as `movenet.tflite` in this folder.
- **MediaPipe Pose Landmarker `.task`** — richer 33-landmark model. Use if you
  wire the MediaPipe plugin path instead (see ../../POSE_INTEGRATION.md).

Models are git-ignored by size; commit via Git LFS or fetch in a postinstall step.
