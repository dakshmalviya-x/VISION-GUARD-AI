# VisionGuard Extension: Operational Troubleshooting Guide

This document provides step-by-step diagnostic workflows for addressing common hardware, browser, computer vision, and runtime issues in **VisionGuard: AI-Powered Facial Access Control System**.

---

## 1. Camera & Hardware Issues

### 1.1 "Camera permission was denied" (`NotAllowedError`)
- **Cause**: User clicked "Block" on the browser's webcam permission prompt, or operating system privacy settings block browser camera access.
- **Resolution**:
  1. Click the lock/camera icon on the left side of the browser address bar.
  2. Toggle Camera permission from "Block" to "Allow".
  3. On Windows 10/11: Go to **Settings > Privacy & Security > Camera**, ensure *"Let desktop apps access your camera"* and *"Let Microsoft Edge/Google Chrome access your camera"* are turned **ON**.
  4. Reload the tab and enable VisionGuard again from the extension popup.

### 1.2 "Camera is already in use by another application" (`NotReadableError` / `TrackStartError`)
- **Cause**: Another process (Zoom, Microsoft Teams, Skype, OBS Studio, or another browser tab) has an exclusive hardware lock on the webcam.
- **Resolution**:
  1. Close video conferencing applications and secondary browser tabs.
  2. In Windows Task Manager (`Ctrl + Shift + Esc`), check for background camera services.
  3. Click "Stop Monitoring" and then "Start Monitoring" in VisionGuard.

### 1.3 "No camera was found on your system" (`NotFoundError`)
- **Cause**: Laptop physical privacy shutter is closed, webcam is disabled via function key (e.g., `Fn + F10`), or hardware cable is detached.
- **Resolution**:
  1. Check for a physical slider/shutter covering your laptop webcam lens.
  2. Verify your camera appears in **Device Manager > Cameras**.

---

## 2. AI Model Loading & WebGL Issues

### 2.1 "Failed to load neural network weights" (`MODEL_ERROR`)
- **Cause**: The extension package is missing model files, the extension was not reloaded after files changed, or a model failed to initialize.
- **Resolution**:
  1. Open the browser's extensions manager and confirm VisionGuard is enabled.
  2. Select **Reload** for VisionGuard, then reload the webpage and enable it again.
  3. Check that these files exist in the extension's `models/` directory:
     - `tiny_face_detector_model-weights_manifest.json` and `.bin`
     - `face_landmark_68_model-weights_manifest.json` and `.bin`
     - `face_recognition_model-weights_manifest.json` and `.bin`

### 2.2 WebGL Context Loss / Performance Lag
- **Cause**: Old graphics drivers or hardware acceleration disabled in browser settings.
- **Resolution**:
  1. In Chrome, go to `chrome://settings/system` and ensure *"Use graphics acceleration when available"* is checked.
  2. Verify WebGL support by navigating to `chrome://gpu`.

---

## 3. Biometric & Computer Vision Calibration

### 3.1 Face Not Detected in Low Lighting
- **Symptom**: Telemetry shows `0 faces detected` even when the user is sitting in front of the laptop.
- **Cause**: Under-exposure reduces contrast around facial landmarks below the detector score threshold (0.50).
- **Resolution**:
  1. Increase ambient lighting or face a window/lamp.
  2. If necessary, adjust the detector's confidence threshold in `js/content-script.js` (`VG_CONFIG`).

### 3.2 False Alerts from Glancing Bystanders
- **Symptom**: Someone walking past the desk triggers `PRIVACY_ALERT`.
- **Cause**: The passerby briefly turned their head, satisfying the angle heuristic.
- **Resolution**:
  1. VisionGuard includes a temporal confirmation window (`FRAME_CONFIRMATION_COUNT: 4`).
  2. To make the system more conservative in busy open-plan offices, increase `FRAME_CONFIRMATION_COUNT` in `VG_CONFIG` in `js/content-script.js`.

### 3.3 Screen Stays Blurred Too Long After Threat Leaves
- **Symptom**: The intruder stepped away, but the screen remains blurred for over 2 seconds.
- **Explanation**: This is an intentional security design feature (**anti-flicker hysteresis**) governed by `RECOVERY_DELAY_MS: 2400`. It ensures the threat has genuinely cleared.
- **Adjustment**: If a faster response is desired for testing, change `RECOVERY_DELAY_MS` in `VG_CONFIG` in `js/content-script.js`.

---

## 4. Enrollment & Local Storage Issues

### 4.1 "Enrollment paused: No face detected"
- **Cause**: The user moved out of frame or looked away during the 5-sample multi-frame capture.
- **Resolution**: Keep your head centered and look directly at the webcam lens until the green progress bar reaches 100%.

### 4.2 Resetting Enrolled User
- **Steps**:
  1. Open the VisionGuard toolbar popup and click **Reset**.
  2. Confirm the prompt. The descriptor is removed from `chrome.storage.local`.
  3. Re-enroll the authorized user before starting monitoring again.
