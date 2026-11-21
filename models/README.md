# Pretrained Computer Vision Models for VisionGuard

This directory houses the offline neural network weights and model manifests utilized by **VisionGuard: AI-Powered Facial Access Control System**.

All models run client-side in the browser via TensorFlow.js / WebGL. No video streams, cropped images, or facial embeddings are transmitted to any external server.

---

## 1. Inventory of Models

| Model Name | Files | Architecture | Input Shape | Purpose in VisionGuard |
|---|---|---|---|---|
| **Tiny Face Detector** | `tiny_face_detector_model-weights_manifest.json`<br>`tiny_face_detector_model.bin` (~190 KB) | Constrained Depthwise Separable CNN | 320x240 or 416x416 RGB | Detects faces in the webcam stream. |
| **Face Landmark 68 Net** | `face_landmark_68_model-weights_manifest.json`<br>`face_landmark_68_model.bin` (~357 KB) | Multi-stage CNN regressor | 150x150 cropped face chip | Predicts 68 facial landmarks for gaze and head-pose estimation. |
| **Face Recognition Net** | `face_recognition_model-weights_manifest.json`<br>`face_recognition_model.bin` (~6.4 MB) | ResNet-34 based deep metric learning architecture | 150x150 normalized face chip | Extracts a 128-dimensional facial descriptor for identity matching. |

---

## 2. Model Roles in VisionGuard Pipeline

1. **Member 1 (Face Detection & Recognition)**:
   - Uses `tiny_face_detector` to detect bounding boxes for people visible in the webcam stream.
   - Uses `face_recognition_model` to project detected faces into a 128-dimensional hypersphere where Euclidean distance represents identity variance.
   - Matches detected embeddings against the enrolled authorized user's stored vector.

2. **Member 2 (Gaze Estimation & Security Logic)**:
   - Uses `face_landmark_68_model` to extract eye corner points, eyelid margins, and key facial anchor points (nose tip, nose bridge, chin).
   - Computes Eye Aspect Ratio (EAR), iris/pupil horizontal & vertical offset ratios, and head pose yaw/pitch to estimate whether a detected face is gazing toward the monitor screen.
   - Feeds detection count, identity match confidence, and gaze direction into the multi-frame security decision engine.

3. **Extension Runtime & Privacy Shield**:
   - Displays the camera preview and face-detection results in the injected widget.
   - Activates or releases the page blur shield and warning banner according to the security state.

---

## 3. Licenses & Provenance

- **Original face-api.js implementation**: Created by Vincent Mühler ([github.com/justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js)), MIT License.
- **Modernized vladmandic/face-api distribution**: Maintained by Vladimir Mandic ([github.com/vladmandic/face-api](https://github.com/vladmandic/face-api)), MIT License.
- **Model weights**: Pretrained on public computer vision benchmarks (WIDER FACE for detection, 300-W for 68 landmarks, and FaceNet / VGGFace2 for 128-d recognition embeddings).
