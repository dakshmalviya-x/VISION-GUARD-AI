# Pretrained Computer Vision Models for VisionGuard

This directory houses the offline neural network weights and model manifests utilized by **VisionGuard: AI-Powered Facial Access Control System**.

All models run client-side in the browser via TensorFlow.js / WebGL. No video streams, cropped images, or facial embeddings are transmitted to any external server.

---

## 1. Inventory of Models

| Model Name | Files | Architecture | Input Shape | Purpose in VisionGuard |
|---|---|---|---|---|
| **Tiny Face Detector** | `tiny_face_detector_model-weights_manifest.json`<br>`tiny_face_detector_model.bin` (~190 KB) | Constrained Depthwise Separable CNN | 320x240 or 416x416 RGB | Real-time face detection with low latency (<15ms per frame on modern browsers). |
| **SSD MobileNet V1** | `ssd_mobilenetv1_model-weights_manifest.json`<br>`ssd_mobilenetv1_model.bin` (~5.6 MB) | Single Shot MultiBox Detector with MobileNetV1 backbone | Dynamic RGB | High-accuracy fallback face detector when higher confidence is required. |
| **Face Landmark 68 Net** | `face_landmark_68_model-weights_manifest.json`<br>`face_landmark_68_model.bin` (~357 KB) | Multi-stage CNN regressor | 150x150 cropped face chip | Predicts 68 2D facial landmark coordinates (eyes, eyebrows, nose, mouth, jawline). Used for gaze & head pose estimation. |
| **Face Landmark 68 Tiny** | `face_landmark_68_tiny_model-weights_manifest.json`<br>`face_landmark_68_tiny_model.bin` (~77 KB) | Lightweight landmark regressor | 150x150 cropped face chip | Ultra-lightweight fallback for low-power hardware. |
| **Face Recognition Net** | `face_recognition_model-weights_manifest.json`<br>`face_recognition_model.bin` (~6.4 MB) | ResNet-34 based deep metric learning architecture | 150x150 normalized face chip | Extracts a 128-dimensional Float32Array facial embedding vector (face descriptor). |

---

## 2. Model Roles in VisionGuard Pipeline

1. **Member 1 (Face Detection & Recognition)**:
   - Uses `tiny_face_detector` or `ssd_mobilenetv1` to detect bounding boxes for each person visible in the webcam stream.
   - Uses `face_recognition_model` to project detected faces into a 128-dimensional hypersphere where Euclidean distance represents identity variance.
   - Matches detected embeddings against the enrolled authorized user's stored vector.

2. **Member 2 (Gaze Estimation & Security Logic)**:
   - Uses `face_landmark_68_model` to extract eye corner points, eyelid margins, and key facial anchor points (nose tip, nose bridge, chin).
   - Computes Eye Aspect Ratio (EAR), iris/pupil horizontal & vertical offset ratios, and head pose yaw/pitch to estimate whether a detected face is gazing toward the monitor screen.
   - Feeds detection count, identity match confidence, and gaze direction into the multi-frame security decision engine.

3. **Member 3 (Frontend & Privacy Shield)**:
   - Visualizes bounding boxes, landmark points, identity labels, and gaze direction arrows on a canvas layer above the webcam feed.
   - Activates or releases the CSS blur shield and warning banner according to the engine's security state.

---

## 3. Licenses & Provenance

- **Original face-api.js implementation**: Created by Vincent Mühler ([github.com/justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js)), MIT License.
- **Modernized vladmandic/face-api distribution**: Maintained by Vladimir Mandic ([github.com/vladmandic/face-api](https://github.com/vladmandic/face-api)), MIT License.
- **Model weights**: Pretrained on public computer vision benchmarks (WIDER FACE for detection, 300-W for 68 landmarks, and FaceNet / VGGFace2 for 128-d recognition embeddings).
