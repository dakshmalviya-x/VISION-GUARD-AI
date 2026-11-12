# VisionGuard: AI-Powered Facial Access Control System
## Comprehensive Technical Project Guide, Architecture & Viva Handbook

**Project Title**: VisionGuard: AI-Powered Facial Access Control System  
**Academic Level**: Undergraduate Computer Science / AI & ML Minor Project  
**Team Structure**: 3-Member Collaborative Team  
**Primary Technologies**: HTML5, CSS3, Vanilla JavaScript (ES2022 Modules), TensorFlow.js, `@vladmandic/face-api`, WebGL, WebRTC  

---

# Table of Contents
1. [Chapter 1 — Project Overview](#chapter-1--project-overview)
2. [Chapter 2 — Fundamental Concepts](#chapter-2--fundamental-concepts)
3. [Chapter 3 — System Architecture & Workflow Diagrams](#chapter-3--system-architecture--workflow-diagrams)
4. [Chapter 4 — Technology Stack & Model Analysis](#chapter-4--technology-stack--model-analysis)
5. [Chapter 5 — Source Code Walkthrough](#chapter-5--source-code-walkthrough)
6. [Chapter 6 — The End-to-End AI Pipeline](#chapter-6--the-end-to-end-ai-pipeline)
7. [Chapter 7 — Security Decision Engine & Hysteresis Algorithms](#chapter-7--security-decision-engine--hysteresis-algorithms)
8. [Chapter 8 — Three-Member Specialization & Viva Guides](#chapter-8--three-member-specialization--viva-guides)
9. [Chapter 9 — Comprehensive Whole-Project Viva Preparation](#chapter-9--comprehensive-whole-project-viva-preparation)
10. [Chapter 10 — Difficult Cross-Examination Defence Guide](#chapter-10--difficult-cross-examination-defence-guide)
11. [Chapter 11 — 5-to-7 Minute Team Presentation Script](#chapter-11--5-to-7-minute-team-presentation-script)
12. [Chapter 12 — Testing Matrix, Verification & Troubleshooting](#chapter-12--testing-matrix-verification--troubleshooting)
13. [Chapter 13 — Architectural Limitations & Future Scope](#chapter-13--architectural-limitations--future-scope)
14. [Chapter 14 — Scientific References, Model Licenses & Glossary](#chapter-14--scientific-references-model-licenses--glossary)

---

# Chapter 1 — Project Overview

### 1.1 Problem Statement
In modern workplaces, knowledge workers, corporate executives, medical practitioners, software engineers, and financial analysts routinely handle confidential data on portable laptops in public and semi-public environments. These environments include open-plan offices, cafes, airport lounges, shared conference rooms, and public transportation. 

While organizations deploy sophisticated firewalls, zero-trust network architectures, and multi-factor authentication to secure digital channels, they remain completely exposed to the oldest and most overlooked physical threat: **shoulder surfing**. Shoulder surfing is the direct, unmonitored visual eavesdropping of on-screen data by an unauthorized bystander standing behind or beside a workstation. 

### 1.2 Motivation
Traditional solutions to shoulder surfing rely on physical polarized privacy filters adhered to the laptop display. While common, physical privacy filters have significant flaws:
- They permanently reduce screen brightness, contrast, and color fidelity by over 30%, causing ocular fatigue.
- They narrow the viewing angle permanently, preventing collaborative viewing even when sharing with an authorized peer.
- They are completely passive: they cannot alert the user when someone is actively looking over their shoulder.
- They provide zero forensic logging or situational awareness.

**VisionGuard** overcomes these limitations by transforming a laptop's standard built-in webcam into an active, intelligent privacy guardian.

### 1.3 Aim and Objectives
- **Aim**: To build a real-time, privacy-preserving client-side computer vision system that monitors visual line-of-sight around a workstation and automatically obscures confidential web content when unauthorized observers gaze toward the screen.
- **Specific Objectives**:
  1. Detect human faces in real time using a lightweight convolutional neural network running locally in the browser.
  2. Implement a separate facial recognition module utilizing deep metric learning (ResNet-34) to match detected faces against an enrolled authorized user.
  3. Estimate gaze direction using geometric head pose (yaw/pitch) and eye landmarks (Eye Aspect Ratio) to assess whether an observer is actively looking at the screen.
  4. Develop a multi-frame security decision engine with anti-flicker temporal confirmation and recovery hysteresis.
  5. Deploy a selective CSS Gaussian blur shield over protected content with a prominent, accessible warning banner.
  6. Ensure 100% client-side execution with zero external network transmission of biometric imagery.

### 1.4 Scope and Webpage-Level Limitation Notice
VisionGuard operates within the modern W3C browser security sandbox. In strict accordance with the Same-Origin Policy and operating system process isolation, JavaScript executing inside a web browser has access **exclusively to its own webpage Document Object Model (DOM)**. VisionGuard can blur only its own application content; it cannot blur external desktop applications (e.g., Microsoft Word, Excel) or the operating system desktop. System-wide display obfuscation would require a native OS service or browser extension.

---

# Chapter 2 — Fundamental Concepts

### 2.1 Artificial Intelligence & Machine Learning vs Rule-Based Logic
- **Artificial Intelligence (AI)** encompasses machines designed to simulate human perception and decision-making.
- **Machine Learning (ML)** uses statistical pattern recognition trained on vast datasets rather than hardcoded heuristics.
- **Rule-Based Logic** executes deterministic `if-else` branching based on fixed conditions.
- *Role in VisionGuard*: AI performs perception (detecting faces, localizing landmarks, computing 128-d vectors). Rule-based logic performs security governance (confirmation buffers, thresholds, cooldown timers).

### 2.2 Computer Vision
Computer vision enables computers to process, analyze, and understand digital images and video streams. In VisionGuard, 640x480 RGB frames are captured from the webcam via the HTML5 `<video>` element, normalized into WebGL tensors, and passed to neural network layers.

### 2.3 Face Detection vs Facial Recognition
- **Face Detection**: Identifies whether a human face is present and returns bounding coordinates `[x, y, w, h]`. It does *not* know who the person is.
- **Facial Recognition**: Identifies the specific identity of the detected face by extracting deep geometric features and comparing them with a known baseline.

### 2.4 Face Embeddings & Deep Metric Learning
A deep metric learning model (ResNet-34) does not classify faces into rigid categories. Instead, it projects aligned facial features into a **128-dimensional continuous vector space** (a hypersphere). Vectors belonging to the same individual cluster tightly together, while vectors belonging to different individuals are mapped far apart.

### 2.5 Euclidean Distance & Similarity Thresholds
The spatial separation between two 128-dimensional embedding vectors $\vec{u}$ and $\vec{v}$ is calculated using Euclidean distance:
$$d(\vec{u}, \vec{v}) = \sqrt{\sum_{i=0}^{127} (u_i - v_i)^2}$$
- $d < 0.52$: Highly confident match (`AUTHORIZED`).
- $0.52 \le d \le 0.64$: Borderline identity (`UNCERTAIN`).
- $d > 0.64$: Definite mismatch (`UNKNOWN` / Unauthorized intruder).

### 2.6 Landmark-Based Gaze & Head Pose Estimation
True eye-tracking requires hardware infrared illumination and corneal reflection tracking. VisionGuard implements a documented geometric approximation:
1. **Head Pose Yaw (Left/Right Rotation)**: Asymmetry of the nose tip relative to outer eye corners.
2. **Head Pose Pitch (Up/Down Tilt)**: Vertical displacement of the nose tip relative to eye-center and chin.
3. **Eye Aspect Ratio (EAR)**: Ratio of eyelid vertical aperture to horizontal width.

### 2.7 Biometric Data Privacy by Design
VisionGuard adheres strictly to privacy-by-design principles:
- No raw face photos or video recordings are saved to disk or sent across networks.
- Only the 128 mathematical floating-point numbers are stored locally in browser `localStorage`.
- The user can permanently delete their biometric template with a single click.

---

# Chapter 3 — System Architecture & Workflow Diagrams

### 3.1 High-Level Architecture
```
+-------------------------------------------------------------------------+
|                           VisionGuard Client                            |
|                                                                         |
|  +--------------------+         +------------------------------------+  |
|  |  Webcam Hardware   | ------> |      CameraManager (camera.js)     |  |
|  +--------------------+         +------------------------------------+  |
|                                                    |                    |
|                                                    v                    |
|                                 +------------------------------------+  |
|                                 |     FaceDetector (TinyFace CNN)    |  |
|                                 +------------------------------------+  |
|                                            |              |             |
|                       +--------------------+              |             |
|                       v                                   v             |
|       +-------------------------------+   +---------------------------+ |
|       |  FaceRecognizer (ResNet-34)   |   | GazeEstimator (68 Points) | |
|       |     128-d Vector Match        |   |   Yaw / Pitch / EAR       | |
|       +-------------------------------+   +---------------------------+ |
|                       |                                   |             |
|                       +--------------------+--------------+             |
|                                            |                            |
|                                            v                            |
|                         +-------------------------------------+         |
|                         |  SecurityDecisionEngine (Rules FSM) |         |
|                         |    4-Frame Buffer & 2.4s Cooldown   |         |
|                         +-------------------------------------+         |
|                                            |                            |
|                                            v                            |
|                         +-------------------------------------+         |
|                         |  Privacy Shield Interface (app.js)  |         |
|                         |    Selective CSS Blur & Overlay     |         |
|                         +-------------------------------------+         |
+-------------------------------------------------------------------------+
```

### 3.2 Security Decision State Machine
```
               +-----------------------+
               |      INITIALIZING     |
               +-----------------------+
                           |
                           v
        +-------------------------------------+
        |         CAMERA / MODEL ERROR        |<-----+ (On Camera/Model Failure)
        +-------------------------------------+      |
                           ^                         |
                           |                         |
               +-----------------------+             |
+------------->|   NO_USER_DETECTED    |             |
|              +-----------------------+             |
| (0 Faces > 2.8s)         | (1 Face Detected)       |
|                          v                         |
|              +-----------------------+             |
|              |        CAUTION        |-------------+
|              +-----------------------+             |
|                 |                 ^                |
| (1 Auth User)   |                 | (Uncertain/    |
|                 v                 |  Threat Cleared|
|              +-----------------------+             |
|              |         SAFE          |-------------+
|              +-----------------------+             |
|                 |                 ^                |
|                 |                 | (Safe Cooldown |
|                 | (Threat >= 4    |  2.4s Elapsed) |
|                 |  Frames)        |                |
|                 v                 |                |
|              +-----------------------+             |
+--------------|     PRIVACY_ALERT     |-------------+
               |  (CSS Blur Activated) |
               +-----------------------+
```

---

# Chapter 4 — Technology Stack & Model Analysis

### 4.1 Frontend Technologies
- **HTML5**: Provides semantic layout (`<video>`, `<canvas>`, `<header>`, `<main>`, `<section>`).
- **CSS3**: Pure modern CSS with custom variables, dark cybersecurity theme, CSS grid, flexbox, and GPU-accelerated blur filters (`filter: blur(22px)`).
- **Vanilla JavaScript (ES2022 Modules)**: Modular separation of concerns (`camera.js`, `face-detection.js`, `face-recognition.js`, `enrollment.js`, `gaze-estimation.js`, `security-engine.js`, `config.js`, `app.js`).

### 4.2 Machine Learning Models & Runtime
1. **TensorFlow.js / WebGL Backend**: Executes neural network tensor computations directly on the laptop's GPU via WebGL shaders.
2. **Tiny Face Detector**: Mobile-optimized CNN utilizing depthwise separable convolutions (~190 KB weights). Processes 640x480 frames in <15ms.
3. **Face Landmark 68 Net**: Deep regression network predicting 68 2D landmark coordinates across eyes, brows, nose, mouth, and jawline (~357 KB weights).
4. **Face Recognition Net**: 34-layer residual convolutional neural network (ResNet-34) trained on millions of face images with triplet loss (~6.4 MB weights). Outputs 128-dimensional descriptors.

---

# Chapter 5 — Source Code Walkthrough

### 5.1 `js/config.js`
Centralized, immutable configuration object deeply frozen via `Object.freeze`:
- `MODELS.BASE_PATH`: Path to offline weights (`./models`).
- `RECOGNITION.MATCH_THRESHOLD`: 0.52 Euclidean distance cutoff.
- `RECOGNITION.UNCERTAIN_THRESHOLD`: 0.64 cutoff.
- `GAZE.YAW_SCREEN_THRESHOLD_DEG`: 22.0° head yaw limit.
- `GAZE.PITCH_SCREEN_THRESHOLD_DEG`: 18.0° head pitch limit.
- `GAZE.EAR_BLINK_THRESHOLD`: 0.18 Eye Aspect Ratio threshold.
- `SECURITY.FRAME_CONFIRMATION_COUNT`: 4 consecutive frames required for alert.
- `SECURITY.RECOVERY_DELAY_MS`: 2400ms safe verification window.

### 5.2 `js/camera.js` (Member 3)
- Manages `navigator.mediaDevices.getUserMedia`.
- Configures 640x480 resolution at 30 FPS.
- Provides hardware track release (`track.stop()`) to ensure the webcam indicator light turns off.
- Translates DOMExceptions into user-friendly error messages (`NotAllowedError`, `NotReadableError`, `NotFoundError`).

### 5.3 `js/face-detection.js` (Member 1)
- Initializes `faceapi.nets.tinyFaceDetector`.
- Function `detectFaces(inputSource)` locates all faces and outputs bounding boxes `[x, y, w, h]` and confidence scores.

### 5.4 `js/face-recognition.js` (Member 1)
- Initializes `faceRecognitionNet` and `faceLandmark68Net`.
- Function `calculateEuclideanDistance(vecA, vecB)` computes mathematical distance.
- Function `matchDescriptor(candidate, enrolled)` returns match status (`AUTHORIZED`, `UNCERTAIN`, `UNKNOWN`), distance, and similarity percentage.

### 5.5 `js/enrollment.js` (Member 1)
- Orchestrates multi-frame capture: collects 5 face samples spaced 350ms apart.
- Averages the 128-d vectors and computes L2-normalization.
- Stores the 128-d vector in browser `localStorage`.
- Exposes `deleteEnrollment()` to permanently remove biometric data.

### 5.6 `js/gaze-estimation.js` (Member 2)
- Calculates Soukupová-Čech Eye Aspect Ratio (EAR) across landmarks 36–41 and 42–47.
- Calculates Head Pose Yaw using nose tip (30) relative to outer eye corners (36, 45).
- Calculates Head Pose Pitch using nose tip relative to eye-center and chin (8).
- Uniquely binds gaze calculations to each face index (`faceIndex`).

### 5.7 `js/security-engine.js` (Member 2)
- Implements state evaluation logic and threat classification.
- Manages consecutive suspicious frame counter.
- Manages recovery cooldown timer (2.4s).
- Enforces invariant safety: hardware or model errors immediately trigger `ERROR` states.

### 5.8 `js/app.js` (Member 3)
- Main application orchestrator.
- Manages camera lifecycle and real-time inference loop using `requestAnimationFrame`.
- Renders bounding boxes, cyber brackets, identity tags, and gaze rays on overlay canvas.
- Dynamically applies `.shield-active` (`filter: blur(22px)`) on `#protected-content`.
- Maintains real-time security audit log.

---

# Chapter 6 — The End-to-End AI Pipeline

```
[Webcam Hardware]
      │ (640x480 @ 30 FPS)
      ▼
[Stage 1: Ingestion & Preprocessing]
      │ HTML5 Video Element -> WebGL Tensor
      ▼
[Stage 2: Real-Time Face Detection]
      │ Tiny Face Detector CNN -> Bounding Boxes
      ▼
[Stage 3: 68-Point Landmark Alignment]
      │ Aligns facial chips for canonical orientation
      ▼
[Stage 4: Deep Biometric Recognition]
      │ ResNet-34 Feature Extractor -> 128-d Embedding Vector
      │ Euclidean Distance Matcher vs Enrolled Vector
      ▼
[Stage 5: Landmark-Based Gaze Estimation]
      │ Soukupová-Čech EAR + Geometric Head Pose (Yaw/Pitch)
      ▼
[Stage 6: Multi-Frame Security Decision Engine]
      │ Evaluates Threat Rules + Hysteresis (4 frames alert, 2.4s recovery)
      ▼
[Stage 7: Privacy Shield Actuation]
      │ Toggles CSS Blur (22px) + Renders Canvas HUD Overlays
```

---

# Chapter 7 — Security Decision Engine & Hysteresis Algorithms

### 7.1 Mathematical Decision Rules
1. **Rule 1 (Failure Invariant)**: If camera is inactive $\rightarrow$ `CAMERA_ERROR`. If models unloaded $\rightarrow$ `MODEL_ERROR`.
2. **Rule 2 (User Absence)**: If detected faces $= 0$ for $> 2.8\text{s} \rightarrow$ `NO_USER_DETECTED`.
3. **Rule 3 (No Enrollment)**: If no enrolled template in storage $\rightarrow$ `CAUTION`.
4. **Rule 4 (Privacy Alert Trigger)**: If an unauthorized face is detected with Gaze = `LOOKING_AT_SCREEN`:
   - Increment `consecutiveSuspiciousFrames`.
   - If `consecutiveSuspiciousFrames` $\ge 4 \rightarrow$ State becomes `PRIVACY_ALERT` and `shouldShieldBlur = true`.
5. **Rule 5 (Recovery Delay)**: When threat clears, if previous state was `PRIVACY_ALERT`:
   - Enforce continuous safe window of $2400\text{ms}$ before deactivating blur.

### 7.2 Decision Logic Pseudocode
```javascript
function evaluateFrame(sceneData) {
  if (!sceneData.isCameraActive) return ERROR('CAMERA_ERROR');
  if (!sceneData.isModelLoaded) return ERROR('MODEL_ERROR');
  
  if (sceneData.faces.length === 0) {
    if (Date.now() - lastFaceTime > 2800) return STATE('NO_USER_DETECTED');
    return HOLD_STATE();
  }
  
  if (!sceneData.hasEnrolledUser) return STATE('CAUTION');
  
  let unauthorizedGazingAtScreen = 0;
  for (let face of sceneData.faces) {
    if (face.matchStatus !== 'AUTHORIZED' && face.gazeState === 'LOOKING_AT_SCREEN') {
      unauthorizedGazingAtScreen++;
    }
  }
  
  if (unauthorizedGazingAtScreen > 0) {
    suspiciousFrames++;
    if (suspiciousFrames >= 4) return STATE('PRIVACY_ALERT', { blur: true });
    return STATE('CAUTION');
  }
  
  if (previousState === 'PRIVACY_ALERT') {
    if (Date.now() - recoveryStartTime < 2400) return HOLD_ALERT_COOLDOWN();
  }
  
  if (sceneData.faces.length === 1 && sceneData.faces[0].matchStatus === 'AUTHORIZED') {
    return STATE('SAFE', { blur: false });
  }
  
  return STATE('CAUTION');
}
```

---

# Chapter 8 — Three-Member Specialization & Viva Guides

### 8.1 Member 1: Face Detection & Facial Recognition
- **Files**: `js/face-detection.js`, `js/face-recognition.js`, `js/enrollment.js`.
- **2-Minute Presentation Pitch**: Explains separation between detection (TinyFace CNN) and recognition (ResNet-34 128-d metric learning), enrollment vector averaging, and biometric privacy.
- **Top 5 Viva Questions**:
  1. *Q: How does ResNet-34 extract features?* A: 34 convolutional layers with residual skip connections output a 128-d vector.
  2. *Q: What is Triplet Loss?* A: A loss function that pulls anchor-positive pairs close ($d(a,p)$) and pushes anchor-negative pairs away ($d(a,n) > d(a,p) + \alpha$).
  3. *Q: Why average 5 samples during enrollment?* A: Cancels transient facial expressions, lighting noise, and sensor jitter.
  4. *Q: What is L2-normalization?* A: Dividing vector by its magnitude so $\|\vec{v}\| = 1.0$.
  5. *Q: Why store vectors in localStorage instead of a database?* A: Keeps biometrics 100% on-device within browser origin isolation.

### 8.2 Member 2: Gaze Estimation & Security Decision Engine
- **Files**: `js/gaze-estimation.js`, `js/security-engine.js`, `js/config.js`.
- **2-Minute Presentation Pitch**: Explains landmark-based head pose approximation, Soukupová-Čech EAR formula, 4-frame confirmation, and 2.4-second recovery cooldown.
- **Top 5 Viva Questions**:
  1. *Q: How is Eye Aspect Ratio calculated?* A: $EAR = (\|p_2 - p_6\| + \|p_3 - p_5\|) / (2 \|p_1 - p_4\|)$.
  2. *Q: How is Head Pose Yaw derived?* A: Horizontal position of nose tip (30) relative to outer eye corners (36, 45).
  3. *Q: Why is recovery delay needed?* A: Prevents rapid flickering when a threat departs.
  4. *Q: How do you prevent identity cross-talk in gaze?* A: Gaze records are explicitly indexed to each detected face (`faceIndex`).
  5. *Q: What happens if camera disconnects?* A: Engine transitions immediately to `CAMERA_ERROR`.

### 8.3 Member 3: Frontend, Privacy Shield & Integration
- **Files**: `index.html`, `css/style.css`, `js/camera.js`, `js/app.js`.
- **2-Minute Presentation Pitch**: Explains responsive cybersecurity dark theme, WebRTC camera lifecycle, canvas HUD overlays, and selective CSS Gaussian blur.
- **Top 5 Viva Questions**:
  1. *Q: Why can't VisionGuard blur external apps like Word?* A: Browser sandbox limits JavaScript DOM access to its own origin.
  2. *Q: How does the camera feed mirror?* A: CSS `transform: scaleX(-1)` creates natural user feedback.
  3. *Q: How does inference throttling work?* A: Inference runs every 110ms while UI renders at 60 FPS using `requestAnimationFrame`.
  4. *Q: How is the alert overlay kept unblurred?* A: The blur is applied to `#protected-content`, while `#privacy-alert-overlay` is a sibling with higher z-index.
  5. *Q: How are camera tracks released?* A: `stream.getTracks().forEach(t => t.stop())`.

---

# Chapter 9 — Comprehensive Whole-Project Viva Preparation
*(Contains 30 foundational questions covering system scope, computer vision, algorithms, and privacy. Full text identical to docs/viva-questions.md).*

---

# Chapter 10 — Difficult Cross-Examination Defence Guide
*(Contains 5 high-difficulty cross-questions with testing goals, defensible answers, common errors, and follow-ups. Full text identical to docs/viva-questions.md).*

---

# Chapter 11 — 5-to-7 Minute Team Presentation Script
*(Contains full presentation dialogue, stage directions, and live demo sequence. Full text identical to docs/presentation-script.md).*

---

# Chapter 12 — Testing Matrix, Verification & Troubleshooting

### 12.1 Automated Test Execution Evidence
All 20 test cases were executed and verified via `node tests/run-tests.js`:
- **TC-01 through TC-03**: Face Recognition & Euclidean metric verification (100% Pass).
- **TC-04 through TC-06**: Gaze & Head Pose estimation (100% Pass).
- **TC-07 & TC-08**: Invariant safety under camera and model errors (100% Pass).
- **TC-09 & TC-10**: Single user SAFE and unauthorized bystander CAUTION (100% Pass).
- **TC-11 & TC-12**: Multi-frame confirmation escalation to PRIVACY_ALERT (100% Pass).
- **TC-13**: Anti-flicker recovery cooldown verification (100% Pass).
- **TC-14 through TC-20**: Edge cases, timeouts, normalization, and config immutability (100% Pass).

---

# Chapter 13 — Architectural Limitations & Future Scope

### 13.1 Current Limitations
1. **Webpage Boundary**: Obfuscates only its own DOM content.
2. **2D Liveness Boundary**: Vulnerable to physical 2D printed photograph spoofing.
3. **Gaze Approximation**: Relies on head pose and eye landmarks rather than infrared corneal reflection.

### 13.2 Concrete Future Enhancements
1. **Desktop Agent**: Packaging via Electron or native C++ daemon with OS window hooks for system-wide blurring.
2. **Challenge-Response Liveness**: Prompting user to blink or smile during authentication.
3. **Hardware Infrared Gaze**: Supporting specialized depth cameras (Intel RealSense).

---

# Chapter 14 — Scientific References, Model Licenses & Glossary
*(Complete bibliography, MIT model licenses, and technical glossary. Full text identical to docs/references.md).*
