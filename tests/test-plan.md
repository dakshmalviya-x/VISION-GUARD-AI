# VisionGuard Extension: Quality Assurance & Verification Test Plan

## 1. Objectives & Scope

This plan covers the automated algorithm checks and manual browser-extension smoke tests for VisionGuard.

### Primary Verification Targets:
1. **Face Recognition & Identity Matching**: Euclidean distance calculation on descriptors and authorized/unknown classifications.
2. **Gaze & Head Pose Estimation**: Landmark-based yaw, pitch, and Eye Aspect Ratio (EAR) calculations.
3. **Security Decision Engine**: State transitions, multi-frame confirmation, and recovery cooldown.
4. **Extension Lifecycle**: Popup activation, camera permissions, model loading, shield behavior, enrollment, and cleanup in a supported browser tab.

---

## 2. Test Environment & Setup

- **Hardware**: Laptop webcam (640x480 @ 30 FPS).
- **Runtime**: Chrome or Microsoft Edge with Manifest V3 support and camera access.
- **Setup**: Load the repository root as an unpacked extension from the browser's extensions manager.
- **Dependencies**: Bundled local `@vladmandic/face-api` (v1.7.15) with offline neural network weights in `./models`.
- **Automated Runner**: Node.js executing `tests/run-tests.js`.

---

## 3. Test Methodology

### 3.1 Unit Testing (Pure Heuristics & Mathematics)
- Verified via `tests/run-tests.js`.
- Tests pure algorithmic functions: vector distances, L2-normalization, geometry calculations, and state machine transitions.

### 3.2 Extension Smoke Test
- Load the project root using **Load unpacked** and enable VisionGuard on a regular webpage.
- Verify camera permission, model loading, enrollment, shield activation, disable/cleanup, and same-tab restart.
- The automated Node.js suite does not exercise browser APIs, camera hardware, or live model inference; those steps require a manual browser check.

### 3.3 Negative & Adversarial Testing
- Validates system behavior when camera permission is denied, camera is disconnected, models are missing, or biometric threshold boundaries are tested.
- Enforces the **Golden Rule**: Errors must never silently be classified as `SAFE`.
