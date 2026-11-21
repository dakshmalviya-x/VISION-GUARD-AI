# VisionGuard: Three-Member Team Contribution & Responsibility Matrix

This document defines the module boundaries, technical ownership, testing duties, and presentation topics for the three team members collaborating on **VisionGuard: AI-Powered Facial Access Control System**.

This is a historical academic contribution record for the earlier standalone prototype. The current extension runtime is documented in [architecture.md](architecture.md); file names and implementation details below may refer to prototype files that are no longer part of the extension package.

All three members worked on a single shared development laptop and common Git repository. To prevent merge conflicts and ensure fair contribution, the architecture is partitioned into three cleanly decoupled subsystems.

---

## Team Overview & Module Assignment

| Team Member | Primary Domain | Core Source Files | Primary Technologies |
|---|---|---|---|
| **Member 1** | Face Detection & Facial Recognition | `js/face-detection.js`<br>`js/face-recognition.js`<br>`js/enrollment.js`<br>`models/README.md` | TinyFaceDetector, ResNet-34, 128-d Vector Embeddings, Euclidean Distance Metric, LocalStorage |
| **Member 2** | Gaze Estimation & Security Decision Engine | `js/gaze-estimation.js`<br>`js/security-engine.js`<br>`js/config.js`<br>`tests/run-tests.js` | 68 Facial Landmarks, Eye Aspect Ratio (EAR), Head Pose (Yaw/Pitch), Finite State Machine, Temporal Hysteresis |
| **Member 3** | Frontend, Privacy Shield, & Integration | `index.html`<br>`css/style.css`<br>`js/camera.js`<br>`js/app.js`<br>`README.md` | Semantic HTML5, Cybersecurity CSS, WebRTC `getUserMedia`, Canvas 2D Overlays, CSS Backdrop Blur |

---

## MEMBER 1: Face Detection & Facial Recognition

### 1.1 Primary Responsibilities
- Research and integrate the browser-based neural network models for face detection and biometric feature extraction.
- Implement the `FaceDetector` module to locate human faces in 640x480 webcam frames and output bounding boxes.
- Implement the `FaceRecognizer` module to generate 128-dimensional floating-point embeddings using deep metric learning (ResNet-34).
- Implement mathematical Euclidean distance matching and similarity confidence calculations.
- Build the `EnrollmentManager` to capture multi-frame samples, average the vectors, L2-normalize the resulting master template, and save only numeric vectors to `localStorage`.
- Ensure strict separation between **Face Detection** ("Where is a face?") and **Face Recognition** ("Who is this person?").

### 1.2 Owned Files
- `js/face-detection.js`
- `js/face-recognition.js`
- `js/enrollment.js`
- `models/` directory & `models/README.md`

### 1.3 Key Theoretical Concepts to Master for Viva
1. **Detection vs Recognition**: Detection outputs bounding boxes; Recognition outputs 128-d feature vectors.
2. **Deep Metric Learning**: How a CNN is trained using Triplet Loss so that faces of the same person have a small distance in hyperspace, while different people have a large distance.
3. **Euclidean Distance Formula**: $d = \sqrt{\sum (A_i - B_i)^2}$.
4. **Biometric Privacy**: Storing numeric vectors instead of raw face images guarantees biometric privacy.
5. **Threshold Calibration**: Why $d < 0.52$ represents an authorized match and $d > 0.64$ represents an unknown intruder.

### 1.4 Member 1 Contribution Checklist
- [x] Integrated pre-trained TinyFaceDetector and ResNet-34 weights into local `./models` directory.
- [x] Implemented single and multi-face detection in `js/face-detection.js`.
- [x] Implemented 128-d vector extraction and Euclidean distance matching in `js/face-recognition.js`.
- [x] Built multi-sample enrollment with L2 vector normalization in `js/enrollment.js`.
- [x] Validated that no raw facial images are stored or transmitted.

### 1.5 Member 1 Test Responsibilities
- **TC-01**: Euclidean metric of identical descriptors ($d = 0.000$).
- **TC-02**: Authorized identity match within tolerance ($d < 0.52$).
- **TC-03**: Identity mismatch for unknown intruder ($d > 0.64$).
- **TC-14**: System handling when no user is enrolled.
- **TC-19**: Mathematical proof of vector L2 normalization ($\|v\| = 1.000$).

---

## MEMBER 2: Gaze Estimation & Security Decision Engine

### 1.1 Primary Responsibilities
- Design and implement the landmark-based gaze and head pose estimation module (`js/gaze-estimation.js`).
- Associate gaze orientation and landmark calculations uniquely with each detected face index.
- Implement Eye Aspect Ratio (EAR) blink detection using Euclidean distances across eye landmarks.
- Calculate Head Pose Yaw (horizontal rotation) and Pitch (vertical tilt) using nose tip and facial perimeter anchors.
- Design the multi-state security engine (`SAFE`, `CAUTION`, `PRIVACY_ALERT`, `NO_USER_DETECTED`, `CAMERA_ERROR`, `MODEL_ERROR`).
- Implement the temporal confirmation counter ($\ge 4$ frames) and recovery delay window ($2.4$ seconds) to prevent visual flickering.
- Maintain the centralized immutable configuration (`js/config.js`).

### 1.2 Owned Files
- `js/gaze-estimation.js`
- `js/security-engine.js`
- `js/config.js`
- `tests/run-tests.js`, `tests/test-plan.md`, `tests/test-cases.md`

### 1.3 Key Theoretical Concepts to Master for Viva
1. **Approximation vs True Eye Tracking**: Honest explanation that webcams lack infrared corneal-reflection sensors; VisionGuard uses geometric facial landmarks and head pose as an honest approximation.
2. **Eye Aspect Ratio (EAR)**: How Soukupová and Čech's formula identifies closed eyes and blinks.
3. **Head Pose Mathematics**: Deriving yaw from nose tip horizontal offset relative to eye outer corners.
4. **Finite State Machine & Hysteresis**: Why temporal confirmation windows and cooldown delays prevent rapid status flickering.
5. **Failure State Invariants**: Why camera or model failures must transition to an explicit `ERROR` state rather than defaulting to `SAFE`.

### 1.4 Member 2 Contribution Checklist
- [x] Built geometric head pose yaw and pitch estimators in `js/gaze-estimation.js`.
- [x] Implemented Soukupová-Čech EAR calculation for blink and eye closure detection.
- [x] Bound gaze outputs specifically to each individual face index to eliminate identity confusion.
- [x] Implemented state transition rules and anti-flicker hysteresis in `js/security-engine.js`.
- [x] Centralized all thresholds and created `tests/run-tests.js` verifying all 20 test cases.

### 1.5 Member 2 Test Responsibilities
- **TC-04**: Direct monitor gaze detection (`LOOKING_AT_SCREEN`).
- **TC-05**: Turned head pose detection (`LOOKING_AWAY`, Yaw > 22°).
- **TC-06**: Eyelid closure / blink detection via EAR ($< 0.18$).
- **TC-11**: Multi-frame accumulation on suspicious viewers.
- **TC-12**: Escalation to `PRIVACY_ALERT` on sustained threat.
- **TC-13**: Anti-flicker recovery delay enforcement ($2.4$s cooldown).

---

## MEMBER 3: Frontend, Privacy Shield, & Integration

### 1.1 Primary Responsibilities
- Build the semantic HTML5 structure and responsive cybersecurity dark-themed CSS (`index.html`, `css/style.css`).
- Implement the hardware camera lifecycle manager (`js/camera.js`) with WebRTC `getUserMedia` and diagnostic error mapping.
- Architect the main integration orchestrator (`js/app.js`) coordinating Camera, Detection, Recognition, Gaze, and Security modules.
- Implement the real-time inference loop using `requestAnimationFrame` with interval throttling.
- Draw high-tech bounding boxes, cyber brackets, identity status pills, and gaze direction vectors on the 2D overlay canvas.
- Build the selective CSS privacy blur filter (`filter: blur(22px)`) on `#protected-content` and the crisp `#privacy-alert-overlay`.
- Implement the interactive enrollment modal and real-time security audit log.

### 1.2 Owned Files
- `index.html`
- `css/style.css`
- `js/camera.js`
- `js/app.js`
- Root `README.md` & `docs/troubleshooting.md`

### 1.3 Key Theoretical Concepts to Master for Viva
1. **Webpage-Level vs Desktop Protection**: Why browser security sandboxing restricts blur effects to the page DOM.
2. **WebRTC MediaStream Lifecycle**: Requesting camera tracks, handling permissions, and calling `track.stop()` to release hardware.
3. **Canvas 2D Coordinate Transformation**: Mirroring the camera and canvas horizontally (`scaleX(-1)`) so user movement feels natural.
4. **Non-Blocking Inference**: Using throttled `requestAnimationFrame` to maintain smooth 60 FPS UI rendering while running 10 FPS AI inference.
5. **CSS Filter Performance**: Hardware acceleration of `backdrop-filter` and `filter: blur()`.

### 1.4 Member 3 Contribution Checklist
- [x] Created responsive dark-theme cybersecurity dashboard in `css/style.css`.
- [x] Implemented WebRTC camera management and exception translation in `js/camera.js`.
- [x] Built the master integration loop in `js/app.js` connecting all three members' code.
- [x] Designed the selective CSS blur and crisp privacy alert overlay.
- [x] Implemented the real-time security event log and user enrollment dialog.

### 1.5 Member 3 Test Responsibilities
- **TC-07**: Camera permission denial and hardware disconnect handling.
- **TC-08**: Graceful UI error reporting when models fail to load.
- **TC-09**: Verified authorized user visualization and unblurred state.
- **TC-10**: Verified amber caution badge rendering on bystander looking away.
- **TC-16**: End-to-end integration test with live video and blur activation.
- **TC-17**: Verified `NO_USER_DETECTED` timeout display.
