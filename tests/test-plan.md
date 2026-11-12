# VisionGuard: Quality Assurance & Verification Test Plan

## 1. Objectives & Scope

The VisionGuard Quality Assurance Test Plan verifies the functional, security, stability, and biometric performance of the **VisionGuard: AI-Powered Facial Access Control System**.

### Primary Verification Targets:
1. **Face Detection Pipeline (Member 1)**: Accuracy in locating single and multiple faces under varied lighting and orientations.
2. **Face Recognition & Identity Matching (Member 1)**: Correct mathematical Euclidean distance calculation on 128-d vectors, discrimination between authorized user and unknown persons, and enrollment template stability.
3. **Gaze & Head Pose Estimation (Member 2)**: Reliable landmark-based estimation of head yaw, pitch, and Eye Aspect Ratio (EAR) blink detection without false attribution.
4. **Security Decision Engine (Member 2)**: Deterministic evaluation of states (`SAFE`, `CAUTION`, `PRIVACY_ALERT`, `NO_USER_DETECTED`, `CAMERA_ERROR`, `MODEL_ERROR`), multi-frame confirmation windows, and recovery cooldown hysteresis.
5. **Frontend, Privacy Shield & Lifecycle (Member 3)**: Selective CSS blur filtering of protected content, readable unblurred alert overlays, camera hardware acquisition and release, and responsive design.

---

## 2. Test Environment & Setup

- **Hardware**: Laptop webcam (640x480 @ 30 FPS).
- **Runtime**: Modern Browser (Chromium / Google Chrome 120+, Microsoft Edge, Mozilla Firefox) with WebGL acceleration.
- **Server**: Local static web server (`python -m http.server 8080` or `npx serve`).
- **Dependencies**: Bundled local `@vladmandic/face-api` (v1.7.15) with offline neural network weights in `./models`.
- **Automated Runner**: Node.js test runner executing `tests/run-tests.js`.

---

## 3. Test Methodology

### 3.1 Unit Testing (Pure Heuristics & Mathematics)
- Verified via `tests/run-tests.js`.
- Tests pure algorithmic functions: vector distances, L2-normalization, geometry calculations, and state machine transitions.

### 3.2 Integration & Browser Testing
- Verified via headless browser automation (`browser_subagent`) and interactive live camera sessions.
- Validates DOM elements, canvas coordinate mirroring, WebGL model loading, camera track lifecycle, and blur activation.

### 3.3 Negative & Adversarial Testing
- Validates system behavior when camera permission is denied, camera is disconnected, models are missing, or biometric threshold boundaries are tested.
- Enforces the **Golden Rule**: Errors must never silently be classified as `SAFE`.
