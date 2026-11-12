/**
 * VisionGuard – Privacy Shield
 * js/content-script.js — Injected into active web pages by background.js.
 *
 * IMPORTANT CONSTRAINTS:
 *  1. No ES module `import` statements — Chrome injects this as a classic
 *     script, so import/export are not available.
 *  2. All dependencies must already be in window scope when this runs:
 *     - `window.faceapi` is set by face-api.js in the same isolated world.
 *  3. All config values are INLINED below (copied from config.js) so this file
 *     is fully self-contained and does not need to load any other VisionGuard module.
 *  4. All DOM elements are created with IDs/classes defined in shield.css,
 *     which background.js injects immediately after this script.
 *
 * LIFECYCLE:
 *   background.js injects shield.css → face-api.js → content-script.js
 *   → content-script.js auto-starts: injects UI → loads models → starts camera
 *   → runs the inference loop until STOP_MONITORING message received.
 */

// Guard active sessions from duplicate injection; teardown resets this flag to allow restart.
if (window.vgActive === true) {
  console.log('[VisionGuard] Content script already active — skipping re-injection.');
} else {

// Mark this page as having VisionGuard running so double-injection is detected.
window.vgActive = true;

// ===========================================================================
// SECTION A: INLINED CONFIGURATION CONSTANTS
// These values are copied from config.js. Inlining avoids the need for
// dynamic module loading which is not available in a classic script injection.
// ===========================================================================

const VG_CONFIG = {
  // The model files are served from the extension's own package.
  // chrome.runtime.getURL converts the relative path to an absolute
  // chrome-extension://... URL that fetch() / face-api can access.
  MODEL_PATH: chrome.runtime.getURL('models'),

  // Euclidean distance thresholds for the 128-d face embedding space:
  //   < MATCH_THRESHOLD        → AUTHORIZED (confident match)
  //   MATCH_THRESHOLD to UNC   → UNCERTAIN  (borderline)
  //   > UNCERTAIN_THRESHOLD    → UNKNOWN    (unauthorized person)
  MATCH_THRESHOLD: 0.52,
  UNCERTAIN_THRESHOLD: 0.64,

  // Enrollment: how many face samples to average to build the master template
  ENROLLMENT_SAMPLE_COUNT: 5,

  // Gap between enrollment samples (ms) — gives the face time to settle
  ENROLLMENT_SAMPLE_INTERVAL_MS: 350,

  // Minimum face detection confidence required for an enrollment sample
  // (frames below this quality are rejected to keep the template clean)
  ENROLLMENT_MIN_CONFIDENCE: 0.65,

  // Key used in chrome.storage.local — must match enrollment.js and popup.js
  STORAGE_KEY: 'visionguard_enrolled_identity_v1',

  // Head pose thresholds (degrees) for considering a face "looking at the screen"
  YAW_THRESHOLD_DEG: 22.0,   // Left/right rotation: > 22° means looking sideways
  PITCH_THRESHOLD_DEG: 18.0, // Up/down tilt: > 18° means looking up or down

  // Eye Aspect Ratio below this value means the eyes are closed/blinking
  EAR_BLINK_THRESHOLD: 0.18,

  // How many consecutive suspicious frames before triggering PRIVACY_ALERT
  // (prevents false alarms from a single noisy detection)
  FRAME_CONFIRMATION_COUNT: 4,

  // Milliseconds of continuous safety required before releasing the blur overlay
  // (prevents the blur from flickering off as soon as the intruder looks away)
  RECOVERY_DELAY_MS: 2400,

  // Milliseconds with no face detected before transitioning to NO_USER_DETECTED
  NO_USER_TIMEOUT_MS: 2800,

  // Minimum gap (ms) between AI inference passes — throttles CPU usage
  // (110ms ≈ ~9 FPS inference rate, smooth enough for detection)
  INFERENCE_INTERVAL_MS: 110,
};

// ===========================================================================
// SECTION B: MODULE-LEVEL STATE
// All mutable state is kept in plain variables so the inference loop can
// read and update them without closures or object references.
// ===========================================================================

// Reference to the <video> element the camera stream is attached to.
// Set by startCamera(); read by the inference loop on every frame.
let vgVideoEl = null;

// Reference to the <canvas> that receives face box / landmark overlays.
let vgCanvasEl = null;

// MediaStream object returned by getUserMedia — stored so we can stop all
// tracks (releasing the camera hardware) when STOP_MONITORING is received.
let vgStream = null;

// Cancels a pending video-metadata wait when monitoring is stopped mid-startup.
let vgCameraStartCancel = null;

// Whether the AI inference loop is currently running.
// Guards against starting the loop twice and checked by message handlers.
let isMonitoring = false;

// requestAnimationFrame handle — stored so we can cancel the loop on cleanup.
let rafHandle = null;

// Timestamp of the last inference pass — used to throttle the frame rate.
// Using DOMHighResTimeStamp (from rAF callback) for precision.
let lastInferenceTime = 0;

// Timestamp of the last time a face was detected — used to trigger
// NO_USER_DETECTED after VG_CONFIG.NO_USER_TIMEOUT_MS of no detections.
let lastFaceDetectedTime = Date.now();

// Consecutive frame counters for the state machine's confirmation windows.
let consecutiveSuspiciousFrames = 0; // Counts suspicious frames toward PRIVACY_ALERT
let safeRecoveryStartTime = null;    // When continuous-safe recovery window started

// Current security state — mirrors SecurityDecisionEngine's state names.
// Starts in INITIALIZING before the AI pipeline is ready.
let currentState = 'INITIALIZING';

// Cached enrolled user object { name, descriptor: Float32Array } or null.
// Refreshed from chrome.storage.local at the start of each monitoring session
// and when the user triggers enrollment via START_ENROLLMENT.
let enrolledUser = null;

// Whether the AI models have finished loading from the extension package.
let modelsLoaded = false;

// Enrollment token invalidates async capture work when stopped or restarted.
let enrollmentRunId = 0;
let isEnrolling = false;

// Named handlers allow teardown to unregister listeners and prevent leaks.
let vgMessageListener = null;
let vgPageHideHandler = null;

// ===========================================================================
// SECTION C: DOM INJECTION
// Creates the camera widget and shield overlay elements and appends them
// to the host page's <body>. Called once at startup.
// ===========================================================================

/**
 * Injects VisionGuard's UI elements into the host page's DOM.
 * Uses IDs and class names that match shield.css rules.
 */
function injectUI() {
  // --- Camera Widget ---
  // The widget shows a live camera preview and the face-box overlay canvas.
  // We check if it already exists (double-injection guard) before creating it.
  if (!document.getElementById('vg-camera-widget')) {
    // Create the outer container div — shield.css positions this in bottom-right.
    const widget = document.createElement('div');
    widget.id = 'vg-camera-widget'; // ID matches the shield.css rule
    widget.dataset.vgOwned = 'true'; // Teardown removes only VisionGuard-owned UI.

    // Label bar at the top of the widget so the user knows what it is.
    const label = document.createElement('div');
    label.className = 'vg-widget-label'; // Styled by shield.css
    label.textContent = '⬡ VISIONGUARD'; // Unicode hexagon as a minimal logo
    widget.appendChild(label);

    // <video> element: the live camera feed will be assigned to this.
    const video = document.createElement('video');
    video.autoplay = true;    // Start playing as soon as a stream is assigned
    video.muted = true;       // No audio needed — also suppresses browser audio prompt
    video.playsInline = true; // Prevents iOS from going fullscreen automatically
    widget.appendChild(video);

    // <canvas> element: drawn on each inference pass to show face boxes.
    const canvas = document.createElement('canvas');
    // Both video and canvas are absolutely positioned on top of each other
    // via shield.css so they overlay correctly inside the widget.
    widget.appendChild(canvas);

    // Store references to the video and canvas for use in the inference loop.
    vgVideoEl = video;
    vgCanvasEl = canvas;

    // Attach the widget to the page body — it will float in the bottom-right corner.
    document.body.appendChild(widget);
  } else {
    // Widget already in DOM — just grab the existing references.
    vgVideoEl = document.querySelector('#vg-camera-widget video');
    vgCanvasEl = document.querySelector('#vg-camera-widget canvas');
  }

  // --- Shield Overlay ---
  // The full-screen overlay that blurs the page during PRIVACY_ALERT.
  if (!document.getElementById('vg-shield-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'vg-shield-overlay'; // ID matches shield.css rule
    overlay.dataset.vgOwned = 'true'; // Teardown removes only VisionGuard-owned UI.

    // Warning icon — a large shield / eye emoji for instant recognition.
    const icon = document.createElement('div');
    icon.className = 'vg-shield-icon';
    icon.textContent = '🛡️'; // Visible at a glance even under blur
    overlay.appendChild(icon);

    // Primary alarm headline.
    const title = document.createElement('div');
    title.className = 'vg-shield-title';
    title.textContent = 'PRIVACY BREACH DETECTED';
    overlay.appendChild(title);

    // Secondary descriptive line.
    const subtitle = document.createElement('div');
    subtitle.className = 'vg-shield-subtitle';
    subtitle.textContent = 'An unauthorized viewer has been detected looking at your screen. Display blurred for your protection.';
    overlay.appendChild(subtitle);

    document.body.appendChild(overlay);
  }

  // --- Enrollment Panel ---
  // Shown during the enrollment capture flow (triggered by START_ENROLLMENT message).
  if (!document.getElementById('vg-enroll-panel')) {
    const panel = document.createElement('div');
    panel.id = 'vg-enroll-panel'; // ID matches shield.css rule
    panel.dataset.vgOwned = 'true'; // Teardown removes only VisionGuard-owned UI.

    const title = document.createElement('div');
    title.className = 'vg-enroll-title';
    title.textContent = 'Enrolling Identity…';
    panel.appendChild(title);

    // Status text updated during the multi-frame capture loop.
    const status = document.createElement('div');
    status.className = 'vg-enroll-status';
    status.id = 'vg-enroll-status';
    status.textContent = 'Please look directly at the camera…';
    panel.appendChild(status);

    // Progress bar track + fill.
    const track = document.createElement('div');
    track.className = 'vg-enroll-progress-track';
    const fill = document.createElement('div');
    fill.className = 'vg-enroll-progress-fill';
    fill.id = 'vg-enroll-progress-fill';
    fill.style.width = '0%'; // Starts empty; updated by updateEnrollProgress()
    track.appendChild(fill);
    panel.appendChild(track);

    document.body.appendChild(panel);
  }
}

// ===========================================================================
// SECTION D: AI MODEL LOADING
// face-api.js exposes its API on window.faceapi in this extension's isolated world.
// ===========================================================================

/**
 * Loads the three neural-network model files needed for the AI pipeline.
 * loadFromUri fetches the JSON manifest + binary weights from the extension
 * package using the chrome-extension:// URL returned by chrome.runtime.getURL.
 *
 * Models loaded (in order):
 *   1. tinyFaceDetector   — fast face detection (Tiny YOLO variant)
 *   2. faceLandmark68Net  — 68 facial landmark point detection
 *   3. faceRecognitionNet — ResNet-34 producing 128-d embedding vectors
 */
async function loadModels() {
  // Alias for brevity — faceapi is set on this isolated world by face-api.js.
  const faceapi = window.faceapi;
  const tf = faceapi.tf;

  // Prefer GPU inference, but select TensorFlow.js CPU explicitly if WebGL is unavailable.
  let webglReady = false;
  try {
    webglReady = await tf.setBackend('webgl');
    if (webglReady) await tf.ready();
  } catch (error) {
    console.warn('[VisionGuard] WebGL backend unavailable; trying CPU inference:', error);
  }
  if (!webglReady) {
    const cpuReady = await tf.setBackend('cpu');
    if (!cpuReady) throw new Error('Neither the WebGL nor CPU TensorFlow.js backend is available.');
    await tf.ready();
    console.warn('[VisionGuard] Using the CPU inference backend; detection may be slower.');
  }
  if (!window.vgActive) return;

  // Tiny Face Detector: chosen for speed on a continuous 30fps webcam loop.
  // The model files live at chrome-extension://<id>/models/tiny_face_detector_model-*.
  await faceapi.nets.tinyFaceDetector.loadFromUri(VG_CONFIG.MODEL_PATH);
  if (!window.vgActive) return;

  // 68-point Landmark Net: required BEFORE computing face descriptors because
  // face-api needs to align (crop + warp) the face chip using the landmarks.
  await faceapi.nets.faceLandmark68Net.loadFromUri(VG_CONFIG.MODEL_PATH);
  if (!window.vgActive) return;

  // Face Recognition Net (ResNet-34): produces the 128-d biometric vector.
  await faceapi.nets.faceRecognitionNet.loadFromUri(VG_CONFIG.MODEL_PATH);
  if (!window.vgActive) return;

  // Set the flag so the inference loop knows it's safe to start processing frames.
  modelsLoaded = true;
}

// ===========================================================================
// SECTION E: CAMERA
// Requests webcam access and attaches the stream to the <video> element.
// ===========================================================================

/**
 * Requests webcam access via the browser's getUserMedia API and attaches
 * the resulting MediaStream to the <video> element we injected into the page.
 * @returns {Promise<void>}
 */
async function startCamera() {
  // Fail explicitly when the browser does not expose camera capture in this context.
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw new Error('Camera capture is unavailable. Use a secure HTTPS page and check browser camera support.');
  }

  // Request access to the user's front camera.
  // We constrain resolution (640×480) and frame rate (30fps max) to match
  // what the AI models were trained on and to keep CPU usage predictable.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:     { ideal: 640 },
      height:    { ideal: 480 },
      facingMode: 'user', // 'user' = front/selfie camera
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false, // VisionGuard never needs audio
  });

  // A disable may arrive while the browser's permission prompt is open.
  // Release a late-granted stream immediately instead of retaining the camera.
  if (!window.vgActive) {
    stream.getTracks().forEach((track) => track.stop());
    return false;
  }

  vgStream = stream;

  // Assign the stream to the <video> element's srcObject property.
  // The browser will automatically start rendering frames once assigned.
  const videoReady = new Promise((resolve, reject) => {
    const cleanupListeners = () => {
      vgVideoEl.removeEventListener('loadedmetadata', onMetadata);
      vgVideoEl.removeEventListener('error', onError);
      vgCameraStartCancel = null;
    };
    const onMetadata = () => {
      cleanupListeners();
      resolve(true);
    };
    const onError = () => {
      cleanupListeners();
      reject(new Error('The browser could not start the webcam preview.'));
    };

    // Let teardown settle this wait if STOP_MONITORING arrives before metadata.
    vgCameraStartCancel = () => {
      cleanupListeners();
      resolve(false);
    };
    vgVideoEl.addEventListener('loadedmetadata', onMetadata, { once: true });
    vgVideoEl.addEventListener('error', onError, { once: true });
    vgVideoEl.srcObject = stream;
    vgVideoEl.play().catch((error) => {
      cleanupListeners();
      reject(error);
    });
  });
  if (!(await videoReady) || !window.vgActive) return false;

  // Sync the canvas dimensions to the video's actual render dimensions.
  // If they differ, face-api's coordinates won't align with what's visible.
  vgCanvasEl.width  = vgVideoEl.videoWidth;
  vgCanvasEl.height = vgVideoEl.videoHeight;
  return true;
}

/**
 * Stops the camera and releases hardware.
 * Called when STOP_MONITORING is received or the page unloads.
 */
function stopCamera() {
  // Wake startup if it is waiting for metadata from a stream being stopped.
  if (vgCameraStartCancel) vgCameraStartCancel();

  if (vgStream) {
    // Stopping each track individually ensures the browser releases the
    // camera hardware indicator (the green camera LED on laptops).
    vgStream.getTracks().forEach((track) => track.stop());
    vgStream = null; // Clear the reference so GC can free the stream object.
  }
  if (vgVideoEl) {
    vgVideoEl.pause();
    vgVideoEl.srcObject = null; // Detach stream from the <video> element.
  }
}

// ===========================================================================
// SECTION F: GAZE ESTIMATION (ported inline from gaze-estimation.js)
// These functions are plain (non-class) versions of GazeEstimator's methods.
// They must be plain functions because we cannot use ES module import here.
// ===========================================================================

/**
 * Computes the Euclidean distance between two 2D landmark points.
 * Used by calculateEAR to measure the opening/closing of the eyelids.
 * @param {{ x: number, y: number }} p1
 * @param {{ x: number, y: number }} p2
 * @returns {number} Pixel distance between the two points.
 */
function vgDist(p1, p2) {
  const dx = p1.x - p2.x; // Horizontal component
  const dy = p1.y - p2.y; // Vertical component
  return Math.sqrt(dx * dx + dy * dy); // Pythagorean theorem
}

/**
 * Computes Soukupová and Čech's Eye Aspect Ratio (EAR):
 *   EAR = ( ||p2 - p6|| + ||p3 - p5|| ) / ( 2 * ||p1 - p4|| )
 *
 * EAR close to 0.0 → eye fully closed (blinking/sleeping).
 * EAR > ~0.2       → eye open.
 * We use a threshold of 0.18 (VG_CONFIG.EAR_BLINK_THRESHOLD).
 *
 * @param {object} p1 ... p6 - 2D landmark points forming the eye outline.
 * @returns {number} EAR value (0.0 = fully closed, ~0.3 = fully open).
 */
function calculateEAR(p1, p2, p3, p4, p5, p6) {
  const verticalA  = vgDist(p2, p6); // Top eyelid ↔ bottom eyelid (outer pair)
  const verticalB  = vgDist(p3, p5); // Top eyelid ↔ bottom eyelid (inner pair)
  const horizontal = vgDist(p1, p4); // Eye width (corner to corner)
  if (horizontal === 0) return 0;    // Avoid division by zero for degenerate cases
  return (verticalA + verticalB) / (2.0 * horizontal);
}

/**
 * Estimates whether a face is looking toward the screen using head pose and EAR.
 * Logic ported from GazeEstimator.estimateGaze() in gaze-estimation.js.
 *
 * @param {any} landmarks - face-api FaceLandmarks68 object (has .positions array)
 * @param {number} detectionScore - Detector confidence (0–1) for this face
 * @returns {{ isLookingAtScreen: boolean, gazeState: string, yawDeg: number, pitchDeg: number, avgEar: number }}
 */
function estimateGaze(landmarks, detectionScore) {
  // Validation: we need all 68 landmark points; return uncertain if unavailable.
  if (!landmarks || !landmarks.positions || landmarks.positions.length < 68) {
    return { isLookingAtScreen: false, gazeState: 'UNCERTAIN', yawDeg: 0, pitchDeg: 0, avgEar: 0 };
  }

  const pts = landmarks.positions; // Array of { x, y } objects, indexed 0–67

  // If the detector is not confident about this face, treat gaze as uncertain.
  // Low confidence means landmark alignment is unreliable.
  if (detectionScore < 0.55) {
    return { isLookingAtScreen: false, gazeState: 'UNCERTAIN', yawDeg: 0, pitchDeg: 0, avgEar: 0 };
  }

  // --- Eye Aspect Ratio ---
  // Left eye: landmarks 36 (outer corner) → 41 (bottom-left); 68-point model convention.
  const leftEar  = calculateEAR(pts[36], pts[37], pts[38], pts[39], pts[40], pts[41]);
  // Right eye: landmarks 45 (outer corner) → 42 (inner corner); note reversed order vs left eye.
  const rightEar = calculateEAR(pts[45], pts[44], pts[43], pts[42], pts[47], pts[46]);
  const avgEar   = (leftEar + rightEar) / 2.0;

  // If both eyes appear closed, we cannot determine gaze direction.
  if (avgEar < VG_CONFIG.EAR_BLINK_THRESHOLD) {
    return { isLookingAtScreen: false, gazeState: 'UNCERTAIN', yawDeg: 0, pitchDeg: 0, avgEar };
  }

  // --- Yaw (left/right head rotation) ---
  // We compare the nose tip's (landmark 30) x-position relative to the eye span.
  const leftEyeOuter  = pts[36]; // Left outer eye corner
  const rightEyeOuter = pts[45]; // Right outer eye corner
  const noseTip       = pts[30]; // Nose tip (landmark 30)
  const eyeSpanX      = Math.abs(rightEyeOuter.x - leftEyeOuter.x); // Face width in pixels

  let yawDeg = 0;
  if (eyeSpanX > 10) { // Minimum span to avoid division noise with tiny/distant faces
    // yawRatio: 0.5 = looking straight ahead; < 0.5 = turned left; > 0.5 = turned right
    const yawRatio = (noseTip.x - leftEyeOuter.x) / eyeSpanX;
    // Empirical mapping: ratio deviation of 0.5 ≈ 42.5°, so multiply by 85.0
    yawDeg = (yawRatio - 0.50) * 85.0;
  }

  // --- Pitch (up/down head tilt) ---
  // We compare the nose tip's y-position relative to the face height.
  const midEyeY   = (leftEyeOuter.y + rightEyeOuter.y) / 2.0; // Vertical midpoint of eyes
  const chin       = pts[8];  // Chin landmark (landmark 8, bottom of face contour)
  const faceHeight = Math.abs(chin.y - midEyeY); // Face height in pixels

  let pitchDeg = 0;
  if (faceHeight > 15) { // Minimum height to avoid noise on small faces
    const pitchRatio = (noseTip.y - midEyeY) / faceHeight;
    // Normal straight-ahead pitch ratio is ~0.37; multiply deviation by 75.0
    pitchDeg = (pitchRatio - 0.37) * 75.0;
  }

  // --- Decision ---
  // The face is "looking at the screen" only if both yaw and pitch are within
  // their respective tolerance thresholds defined in VG_CONFIG.
  const isYawOk   = Math.abs(yawDeg)   <= VG_CONFIG.YAW_THRESHOLD_DEG;
  const isPitchOk = Math.abs(pitchDeg) <= VG_CONFIG.PITCH_THRESHOLD_DEG;

  if (isYawOk && isPitchOk) {
    return { isLookingAtScreen: true,  gazeState: 'LOOKING_AT_SCREEN', yawDeg, pitchDeg, avgEar };
  } else {
    return { isLookingAtScreen: false, gazeState: 'LOOKING_AWAY',      yawDeg, pitchDeg, avgEar };
  }
}

// ===========================================================================
// SECTION G: FACE RECOGNITION (ported inline from face-recognition.js)
// ===========================================================================

/**
 * Computes the Euclidean distance between two 128-dimensional face descriptor vectors.
 *   d = sqrt( Σ (A[i] - B[i])² ) for i in 0..127
 *
 * Smaller distance = more similar faces.
 * Typical distances: same person ~0.3–0.5, different people ~0.6–1.2.
 *
 * @param {Float32Array} a - Candidate descriptor (detected face)
 * @param {Float32Array} b - Enrolled descriptor (stored authorized user)
 * @returns {number} Euclidean distance in 128-d space.
 */
function calcEuclideanDist(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity; // Invalid inputs — treat as no match
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]; // Component-wise difference
    sum += diff * diff;        // Square and accumulate
  }
  return Math.sqrt(sum); // Square root gives the true geometric distance
}

/**
 * Classifies a detected face descriptor against the enrolled authorized descriptor.
 * Implements the three-tier match classification:
 *   AUTHORIZED  — distance < MATCH_THRESHOLD (0.52)
 *   UNCERTAIN   — distance between MATCH_THRESHOLD and UNCERTAIN_THRESHOLD (0.64)
 *   UNKNOWN     — distance > UNCERTAIN_THRESHOLD
 *
 * @param {Float32Array} candidate - 128-d vector of the currently detected face
 * @param {Float32Array} enrolled  - 128-d vector of the authorized enrolled user
 * @returns {{ matchStatus: string, isMatch: boolean, distance: number }}
 */
function matchDescriptor(candidate, enrolled) {
  // If nothing is enrolled, every face is unknown — cannot authorize anyone.
  if (!enrolled) {
    return { matchStatus: 'UNKNOWN', isMatch: false, distance: 1.0 };
  }

  const dist = calcEuclideanDist(candidate, enrolled); // Geometric distance in 128-d space

  if (dist < VG_CONFIG.MATCH_THRESHOLD) {
    // Confident match: the detected face is the authorized user.
    return { matchStatus: 'AUTHORIZED', isMatch: true, distance: dist };
  } else if (dist <= VG_CONFIG.UNCERTAIN_THRESHOLD) {
    // Borderline: treat as not authorized but do not raise full alert yet.
    return { matchStatus: 'UNCERTAIN', isMatch: false, distance: dist };
  } else {
    // Definite mismatch: a different person is at the screen.
    return { matchStatus: 'UNKNOWN', isMatch: false, distance: dist };
  }
}

// ===========================================================================
// SECTION H: CHROME STORAGE — ENROLLMENT READ/WRITE
// ===========================================================================

/**
 * Reads the enrolled user profile from chrome.storage.local.
 * Returns the profile { name, descriptor: Float32Array } or null if not enrolled.
 * Uses a Promise wrapper because storage.local is callback-based.
 * @returns {Promise<{ name: string, descriptor: Float32Array } | null>}
 */
function getEnrolledUser() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(VG_CONFIG.STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const data = result[VG_CONFIG.STORAGE_KEY]; // The stored object (or undefined)

      // Validate that the stored data has the expected structure.
      if (data && data.descriptor && Array.isArray(data.descriptor) && data.descriptor.length === 128) {
        // Convert the plain array (JSON-serializable) back to a typed Float32Array
        // so face-api and our Euclidean distance function can operate on it efficiently.
        resolve({ name: data.name || 'Authorized User', descriptor: new Float32Array(data.descriptor) });
      } else {
        // No valid enrollment found — return null so the state machine knows.
        resolve(null);
      }
    });
  });
}

/**
 * Saves the averaged, L2-normalized 128-d descriptor to chrome.storage.local.
 * Only the 128 numbers are stored — no images, no biometric metadata beyond the name.
 * @param {string} name - Display name for the enrolled user.
 * @param {Float32Array} descriptor - The averaged, normalized 128-d vector.
 * @returns {Promise<void>}
 */
function saveEnrolledUser(name, descriptor) {
  return new Promise((resolve, reject) => {
    const profile = {
      name: name || 'Authorized User',
      enrolledAt: new Date().toISOString(), // ISO timestamp for display/audit
      sampleCount: VG_CONFIG.ENROLLMENT_SAMPLE_COUNT,
      // Convert Float32Array to a plain Array so it can be JSON-serialized by storage.local.
      descriptor: Array.from(descriptor),
    };
    // Store with our canonical key so popup.js and enrollment.js read the same entry.
    chrome.storage.local.set({ [VG_CONFIG.STORAGE_KEY]: profile }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

// ===========================================================================
// SECTION I: SECURITY STATE MACHINE (simplified inline version)
// Logic ported from SecurityDecisionEngine.evaluateFrame() in security-engine.js.
// ===========================================================================

/**
 * Evaluates the current scene and returns the new security state.
 * Implements the multi-frame confirmation window (FRAME_CONFIRMATION_COUNT)
 * and the recovery delay (RECOVERY_DELAY_MS) from the main security engine.
 *
 * @param {{ faces: Array, hasEnrolled: boolean }} scene
 * @returns {string} One of: 'SAFE', 'CAUTION', 'PRIVACY_ALERT', 'NO_USER_DETECTED', 'INITIALIZING'
 */
function evaluateScene(scene) {
  const now      = Date.now();
  const faces    = scene.faces || [];
  const faceCount = faces.length;

  // --- No face in frame ---
  if (faceCount === 0) {
    const timeSinceLastFace = now - lastFaceDetectedTime;
    // Brief dropouts (blinks, motion blur) should not change the state immediately.
    if (timeSinceLastFace > VG_CONFIG.NO_USER_TIMEOUT_MS) {
      consecutiveSuspiciousFrames = 0; // Reset suspicious counter — no one is here
      safeRecoveryStartTime = null;
      return 'NO_USER_DETECTED';
    }
    // Dropout is short — maintain current state to avoid flickering.
    return currentState;
  }

  // A face is visible — update the last-seen timestamp.
  lastFaceDetectedTime = now;

  // --- No enrolled user: cannot verify anyone ---
  if (!scene.hasEnrolled) {
    consecutiveSuspiciousFrames = 0;
    safeRecoveryStartTime = null;
    return 'CAUTION'; // We see a face but have no reference to compare against
  }

  // --- Analyse each detected face ---
  let authorizedCount = 0;
  let unauthorizedLookingAtScreen = 0;
  let cautionCount = 0; // UNCERTAIN match or unknown-but-looking-away

  for (let i = 0; i < faces.length; i++) {
    const { matchResult, gazeResult } = faces[i];

    if (matchResult.matchStatus === 'AUTHORIZED') {
      authorizedCount++; // This face is the enrolled user — no threat from them
    } else if (matchResult.matchStatus === 'UNCERTAIN') {
      cautionCount++; // Borderline recognition — elevated caution but not full alert
    } else {
      // UNKNOWN: different person
      if (gazeResult.gazeState === 'LOOKING_AT_SCREEN') {
        // The unknown person IS looking at the screen — this is a privacy breach.
        unauthorizedLookingAtScreen++;
      } else {
        // Unknown person is nearby but looking away — caution but not critical
        cautionCount++;
      }
    }
  }

  // --- Threat Classification ---

  if (unauthorizedLookingAtScreen > 0) {
    // Build up consecutive suspicious frame count toward the confirmation threshold.
    consecutiveSuspiciousFrames++;
    safeRecoveryStartTime = null; // Reset any recovery timer — still a threat

    if (consecutiveSuspiciousFrames >= VG_CONFIG.FRAME_CONFIRMATION_COUNT) {
      // Confirmed breach across multiple frames — activate full alert.
      return 'PRIVACY_ALERT';
    }
    // Not yet confirmed — stay in CAUTION as frames accumulate.
    return 'CAUTION';
  }

  if (cautionCount > 0 || (faceCount > 1 && authorizedCount > 0)) {
    // Multiple faces (even if one is authorized) or uncertain identities = caution.
    consecutiveSuspiciousFrames = 0;
    safeRecoveryStartTime = null;
    return 'CAUTION';
  }

  if (faceCount === 1 && authorizedCount === 1) {
    // Only the authorized user is visible — potential SAFE state.
    consecutiveSuspiciousFrames = 0; // No threat

    if (currentState === 'PRIVACY_ALERT') {
      // We were in PRIVACY_ALERT — enforce the recovery delay before unblurring.
      // This prevents the overlay from flickering off if the intruder briefly looks away.
      if (!safeRecoveryStartTime) safeRecoveryStartTime = now;
      const elapsed   = now - safeRecoveryStartTime;
      const remaining = VG_CONFIG.RECOVERY_DELAY_MS - elapsed;
      if (remaining > 0) {
        // Still within cooldown — keep the overlay active.
        return 'PRIVACY_ALERT';
      }
    }

    // Recovery period satisfied (or we weren't in PRIVACY_ALERT) — declare SAFE.
    safeRecoveryStartTime = null;
    return 'SAFE';
  }

  // Fallback: single unknown face looking away → CAUTION.
  consecutiveSuspiciousFrames = 0;
  safeRecoveryStartTime = null;
  return 'CAUTION';
}

// ===========================================================================
// SECTION J: OVERLAY CONTROL
// Shows/hides the #vg-shield-overlay element based on the security state.
// ===========================================================================

/**
 * Applies visual changes to the page based on the new security state.
 * Called after every evaluateScene() that returns a changed state.
 * @param {string} state - The new security state string.
 */
function applyState(state) {
  const overlay = document.getElementById('vg-shield-overlay');
  if (!overlay) return; // Overlay may not be in DOM yet during early init

  if (state === 'PRIVACY_ALERT') {
    // Show the overlay — this is the main privacy protection mechanism.
    // We switch from display:none to display:flex (flex is used to centre the warning text).
    overlay.style.display = 'flex';
  } else {
    // All non-alert states: hide the overlay so the page content is visible.
    overlay.style.display = 'none';
  }

  // Update the camera widget border colour so the user gets a colour-coded signal.
  const widget = document.getElementById('vg-camera-widget');
  if (widget) {
    if (state === 'PRIVACY_ALERT') {
      widget.style.borderColor = '#ff1744'; // Red border in alert state
    } else if (state === 'CAUTION') {
      widget.style.borderColor = '#ff9100'; // Amber in caution state
    } else if (state === 'SAFE') {
      widget.style.borderColor = '#00e676'; // Green when safe
    } else {
      widget.style.borderColor = 'rgba(0, 229, 255, 0.35)'; // Default cyan (initializing / no user)
    }
  }
}

// ===========================================================================
// SECTION K: PER-FRAME INFERENCE
// ===========================================================================

/**
 * Processes a single video frame through the AI pipeline:
 *   1. Face detection + landmark + descriptor extraction (face-api)
 *   2. Identity matching (calcEuclideanDist / matchDescriptor)
 *   3. Gaze estimation (estimateGaze)
 *   4. Security state machine (evaluateScene)
 *   5. Visual updates (applyState, drawOverlay)
 *
 * @param {Float32Array | null} enrolledDescriptor - Stored authorized user's 128-d vector, or null.
 */
async function processFrame(enrolledDescriptor) {
  // Guard: video must be ready and have valid dimensions before we can run face-api.
  if (!vgVideoEl || vgVideoEl.readyState < 2 || vgVideoEl.videoWidth === 0) return;

  const faceapi = window.faceapi; // face-api.js global — set by the injected vendor script

  // Build face-api detector options: TinyFaceDetector with 320px input for speed.
  const detectorOptions = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,       // Input resolution fed to the neural network; lower = faster
    scoreThreshold: 0.5,  // Discard detections with confidence < 50%
  });

  // Run the full detection pipeline:
  //   detectAllFaces: finds bounding boxes for all visible faces
  //   .withFaceLandmarks(): computes 68 landmark points per face
  //   .withFaceDescriptors(): computes the 128-d embedding per face
  // We use detectAllFaces (not Just One Face) so we detect shoulder-surfers.
  let detections;
  try {
    detections = await faceapi
      .detectAllFaces(vgVideoEl, detectorOptions)
      .withFaceLandmarks()
      .withFaceDescriptors();
  } catch (err) {
    console.warn('[VisionGuard] face-api inference error', err);
    return; // Skip this frame on error — do not change state
  }

  // Resize detection coordinates from the model's input resolution to the video's
  // actual display resolution so face boxes align with what the user sees.
  const displaySize = { width: vgVideoEl.videoWidth, height: vgVideoEl.videoHeight };
  const resized = faceapi.resizeResults(detections, displaySize);

  // Build the scene data structure for the security state machine.
  const faceData = resized.map((det) => {
    const descriptor = det.descriptor; // Float32Array — the 128-d biometric vector
    const landmarks  = det.landmarks;  // FaceLandmarks68 object
    const score      = det.detection.score; // Detection confidence (0–1)

    // Match this face against the enrolled user.
    const matchResult = matchDescriptor(descriptor, enrolledDescriptor);

    // Estimate whether this face is oriented toward the screen.
    const gazeResult  = estimateGaze(landmarks, score);

    return { matchResult, gazeResult, score, detection: det.detection };
  });

  // Run the security state machine to determine the new state.
  const newState = evaluateScene({
    faces: faceData,
    hasEnrolled: !!enrolledDescriptor,
  });

  // Apply visual changes only when the state actually changes to avoid
  // redundant DOM writes on every frame (which would cause layout thrashing).
  if (newState !== currentState) {
    currentState = newState;
    applyState(currentState);
  }

  // Draw face overlay boxes and state labels on the canvas.
  drawOverlay(resized, faceData);
}

// ===========================================================================
// SECTION L: CANVAS OVERLAY DRAWING
// ===========================================================================

/**
 * Draws face bounding boxes and gaze/match status labels onto the canvas.
 * The canvas is overlaid on top of the <video> element (see shield.css).
 *
 * @param {Array} resized - Resized face-api detections (with landmarks/descriptors).
 * @param {Array} faceData - Array of { matchResult, gazeResult } per face.
 */
function drawOverlay(resized, faceData) {
  if (!vgCanvasEl) return;

  // Get the 2D drawing context — this gives us rect/text drawing methods.
  const ctx = vgCanvasEl.getContext('2d');

  // Clear the entire canvas before drawing the new frame's data.
  // Not clearing causes old frames' boxes to persist ("ghost" boxes).
  ctx.clearRect(0, 0, vgCanvasEl.width, vgCanvasEl.height);

  for (let i = 0; i < resized.length; i++) {
    const det    = resized[i];
    const data   = faceData[i];
    const box    = det.detection.box; // { x, y, width, height } in display pixels
    const match  = data.matchResult;
    const gaze   = data.gazeResult;

    // Choose box colour based on match and gaze state.
    // This colour scheme mirrors the main app's canvas drawing logic in app.js.
    let colour;
    if (match.matchStatus === 'AUTHORIZED') {
      colour = '#00e5ff'; // Cyan → authorized user
    } else if (match.matchStatus === 'UNCERTAIN') {
      colour = '#ffd600'; // Yellow → uncertain identity
    } else if (gaze.gazeState === 'LOOKING_AT_SCREEN') {
      colour = '#ff1744'; // Red → unknown person looking at screen (high threat)
    } else {
      colour = '#ff9100'; // Amber → unknown person not looking at screen (caution)
    }

    // Draw the face bounding box rectangle.
    ctx.strokeStyle = colour;
    ctx.lineWidth   = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Draw a small label above the box with match status and gaze state.
    const label = `${match.matchStatus} · ${gaze.gazeState}`;
    ctx.font      = 'bold 10px monospace';
    ctx.fillStyle = colour;
    // Position label just above the box, with a small vertical gap.
    ctx.fillText(label, box.x, Math.max(box.y - 6, 12));
  }
}

// ===========================================================================
// SECTION M: INFERENCE LOOP
// Uses requestAnimationFrame for a smooth loop, but throttles actual AI
// inference to once every INFERENCE_INTERVAL_MS to keep CPU load manageable.
// ===========================================================================

/**
 * The main animation + inference loop.
 * requestAnimationFrame calls this on every display refresh (~60fps on most monitors).
 * We throttle the actual face-api inference to once per INFERENCE_INTERVAL_MS
 * to keep CPU usage predictable without sacrificing responsiveness.
 *
 * @param {DOMHighResTimeStamp} timestamp - Current time in ms, provided by rAF.
 */
async function runInferenceLoop(timestamp) {
  // If monitoring was stopped externally (via STOP_MONITORING message), exit the loop.
  if (!isMonitoring) return;

  // Schedule the next animation frame immediately so the loop continues.
  // We do this BEFORE the async inference so the loop doesn't stall while awaiting.
  rafHandle = requestAnimationFrame(runInferenceLoop);

  // Throttle: only run inference if enough time has elapsed since the last pass.
  // This prevents face-api from running 60 times per second, which would saturate the CPU.
  const elapsed = timestamp - lastInferenceTime;
  if (elapsed < VG_CONFIG.INFERENCE_INTERVAL_MS) return; // Too soon — skip this frame
  lastInferenceTime = timestamp; // Record when this inference pass started

  // Fetch the latest enrolled user descriptor on every inference pass.
  // This ensures that if the user enrolls or resets while monitoring, the
  // system picks up the change without needing a restart.
  let user;
  try {
    user = await getEnrolledUser();
  } catch (error) {
    console.error('[VisionGuard] Could not read the enrolled identity:', error);
    return;
  }
  enrolledUser = user;
  const descriptor = user ? user.descriptor : null;

  // Run the AI pipeline on the current video frame.
  await processFrame(descriptor);
}

// ===========================================================================
// SECTION N: ENROLLMENT FLOW (triggered by START_ENROLLMENT message)
// ===========================================================================

/**
 * Runs the multi-frame face capture enrollment flow directly in the page.
 * Shows the #vg-enroll-panel UI during capture, then saves the averaged
 * and L2-normalized descriptor to chrome.storage.local.
 */
async function runEnrollmentFlow() {
  // Enrollment is available only after models and the camera are ready.
  if (!isMonitoring || !modelsLoaded || isEnrolling || !vgVideoEl) return false;

  isEnrolling = true;
  const runId = ++enrollmentRunId;
  const isCurrentRun = () => window.vgActive && isMonitoring && enrollmentRunId === runId;
  const faceapi = window.faceapi;

  // Show the enrollment panel UI.
  const panel = document.getElementById('vg-enroll-panel');
  if (panel) panel.style.display = 'flex';

  /**
   * Helper to update the enrollment panel's status text and progress bar.
   * @param {string} message - Text to display to the user.
   * @param {number} step    - Current sample number (0 = not started).
   * @param {number} total   - Total samples to collect.
   */
  function updateEnrollProgress(message, step, total) {
    const statusEl = document.getElementById('vg-enroll-status');
    const fillEl   = document.getElementById('vg-enroll-progress-fill');
    if (statusEl) statusEl.textContent = message;
    if (fillEl)   fillEl.style.width   = `${(step / total) * 100}%`;
  }

  const totalSamples = VG_CONFIG.ENROLLMENT_SAMPLE_COUNT; // 5 by default
  const collected    = []; // Will hold Float32Array descriptors for each sample

  updateEnrollProgress('Look directly at the camera…', 0, totalSamples);

  const detectorOptions = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.5,
  });

  try {
    for (let i = 0; i < totalSamples; i++) {
      // Wait between samples to allow the face to settle and avoid consecutive
      // near-identical frames that would not add noise-cancellation value.
      await new Promise((r) => setTimeout(r, VG_CONFIG.ENROLLMENT_SAMPLE_INTERVAL_MS));
      if (!isCurrentRun()) return false;

      // Capture faces with full descriptor pipeline.
      const faces = await faceapi
        .detectAllFaces(vgVideoEl, detectorOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (!isCurrentRun()) return false;

      if (faces.length === 0) {
        throw new Error(`Sample ${i + 1}: No face detected. Ensure good lighting and face the camera.`);
      }
      if (faces.length > 1) {
        throw new Error(`Sample ${i + 1}: Multiple faces detected. Only the enrolling user may be in frame.`);
      }

      const score = faces[0].detection.score;
      if (score < VG_CONFIG.ENROLLMENT_MIN_CONFIDENCE) {
        throw new Error(`Sample ${i + 1}: Detection quality too low (${score.toFixed(2)}). Look straight ahead.`);
      }

      // Store this sample's descriptor as a typed array for precise averaging.
      collected.push(new Float32Array(faces[0].descriptor));
      updateEnrollProgress(`Captured sample ${i + 1} of ${totalSamples}…`, i + 1, totalSamples);
    }

    // --- Average the collected descriptors ---
    // Averaging multiple samples cancels out per-frame sensor noise, producing
    // a more stable and robust biometric template than a single capture.
    const averaged = new Float32Array(128); // Start with all zeros
    for (let d = 0; d < 128; d++) {
      let sum = 0;
      for (let s = 0; s < collected.length; s++) sum += collected[s][d];
      averaged[d] = sum / collected.length; // Component-wise mean
    }

    // --- L2-Normalise the averaged vector ---
    // Normalisation ensures the vector lies on the unit hypersphere, which
    // keeps Euclidean distance values geometrically calibrated across
    // different lighting conditions and camera angles.
    let norm = 0;
    for (let d = 0; d < 128; d++) norm += averaged[d] * averaged[d];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let d = 0; d < 128; d++) averaged[d] /= norm;
    }

    // Prompt for a user name (optional — defaults to 'Authorized User').
    const name = prompt('Enrollment complete! Enter your name (optional):') || 'Authorized User';
    if (!isCurrentRun()) return false;

    // Save the profile to chrome.storage.local.
    await saveEnrolledUser(name, averaged);
    if (!isCurrentRun()) return false;

    updateEnrollProgress(`✓ ${name} enrolled successfully!`, totalSamples, totalSamples);

    // Refresh the cached enrolled user so the inference loop uses the new profile immediately.
    enrolledUser = await getEnrolledUser();

    // Hide the enrollment panel after a short delay so the user can read the success message.
    setTimeout(() => {
      if (panel) panel.style.display = 'none';
    }, 2000);

  } catch (err) {
    // A canceled enrollment is expected during teardown and must not revive UI.
    if (!isCurrentRun()) return false;

    // Show the error in the enrollment panel so the user understands what went wrong.
    updateEnrollProgress(`⚠ ${err.message}`, 0, totalSamples);
    console.error('[VisionGuard] Enrollment error:', err);

    // Hide the panel after 4 seconds so the user can retry.
    setTimeout(() => {
      if (panel) panel.style.display = 'none';
    }, 4000);
  } finally {
    if (enrollmentRunId === runId) isEnrolling = false;
  }
}

// ===========================================================================
// SECTION O: MESSAGE LISTENER
// Routes messages from popup.js (via background.js) to the correct handler.
// ===========================================================================

vgMessageListener = (message, sender, sendResponse) => {
  // --- START_ENROLLMENT ---
  // Sent by popup.js when the user clicks "Enroll User".
  if (message.type === 'START_ENROLLMENT') {
    if (!isMonitoring || !modelsLoaded || !vgVideoEl) {
      sendResponse({ started: false, error: 'VisionGuard is still starting or is not active.' });
      return;
    }
    if (isEnrolling) {
      sendResponse({ started: false, error: 'Enrollment is already in progress.' });
      return;
    }
    runEnrollmentFlow(); // The guided panel reports progress and completion in the page.
    sendResponse({ started: true });
    return;
  }

  // --- STOP_MONITORING ---
  // Sent by background.js when the user clicks "Disable Shield" in the popup.
  if (message.type === 'STOP_MONITORING') {
    teardownVisionGuard(false);
    sendResponse({ stopped: true });
    return;
  }

  // --- GET_STATUS ---
  // Allows the popup or background to query whether monitoring is active.
  if (message.type === 'GET_STATUS') {
    sendResponse({ active: window.vgActive === true, monitoring: isMonitoring, state: currentState });
    return;
  }
};
chrome.runtime.onMessage.addListener(vgMessageListener);

// ===========================================================================
// SECTION P: TEARDOWN AND AUTO-START
// ===========================================================================

/**
 * Stops all VisionGuard-owned work and removes the listeners and UI for this run.
 * @param {boolean} notifyBackground - Whether to clear the tab's active marker.
 */
function teardownVisionGuard(notifyBackground) {
  // Reset the injection guard first so an immediate ON action can create a fresh run.
  window.vgActive = false;
  isMonitoring = false;
  modelsLoaded = false;
  currentState = 'INITIALIZING';
  consecutiveSuspiciousFrames = 0;
  safeRecoveryStartTime = null;
  enrolledUser = null;
  enrollmentRunId++;
  isEnrolling = false;

  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  stopCamera();
  chrome.runtime.onMessage.removeListener(vgMessageListener);
  window.removeEventListener('pagehide', vgPageHideHandler);

  // Remove only elements created by VisionGuard; never delete page-owned nodes.
  document.querySelectorAll('[data-vg-owned="true"]').forEach((element) => element.remove());
  vgVideoEl = null;
  vgCanvasEl = null;

  // A pagehide cleanup must also clear the service worker's per-tab status.
  if (notifyBackground) {
    chrome.runtime.sendMessage({ type: 'TAB_DEACTIVATED' }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[VisionGuard] Could not notify the service worker during page teardown.');
      }
    });
  }
}

/**
 * Entry point: called once when the content script is first injected.
 * Sets up the UI, loads models, starts the camera, then begins the inference loop.
 */
async function vgInit() {
  try {
    // Step 1: Inject the camera widget and overlay elements into the host page.
    injectUI();

    // Step 2: Load the AI models from the extension's /models directory.
    // This may take a few seconds on first run (network fetch of binary weights).
    await loadModels();
    if (!window.vgActive) return;

    // Step 3: Start the webcam stream and attach it to the <video> element.
    if (!(await startCamera()) || !window.vgActive) return;

    // Step 4: Load the enrolled user descriptor so the first frame has it available.
    enrolledUser = await getEnrolledUser();
    if (!window.vgActive) return;

    // Step 5: Mark as active and start the inference loop.
    isMonitoring = true;
    currentState = 'INITIALIZING';
    lastFaceDetectedTime = Date.now(); // Reset so NO_USER_DETECTED doesn't fire immediately.

    // Kick off the rAF-based inference loop.
    rafHandle = requestAnimationFrame(runInferenceLoop);

    console.log('[VisionGuard] Monitoring started on', window.location.href);
  } catch (err) {
    // STOP_MONITORING can cancel startup; do not report that expected cancellation as an error.
    if (!window.vgActive) return;

    console.error('[VisionGuard] Initialization failed:', err);
    teardownVisionGuard(true);
    const reason = err.name === 'NotAllowedError'
      ? 'Camera access was denied or blocked. Check this site’s camera permission and browser restrictions.'
      : `Startup failed: ${err.message || err}`;
    alert(`VisionGuard could not start. ${reason}`);
  }
}

// Tear down the stream if the user navigates away or closes this document.
vgPageHideHandler = () => teardownVisionGuard(true);
window.addEventListener('pagehide', vgPageHideHandler);

// Run the initialization immediately (this script is injected by background.js
// only when the user explicitly enables VisionGuard on this tab).
vgInit();

} // end of double-injection guard block
