/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Main Application Orchestrator & UI Controller (js/app.js)
 *
 * Maintained primarily by Member 3 (Frontend, Privacy Shield, and Integration)
 * in close collaboration with Member 1 (CV & Recognition) and Member 2 (Gaze & Security Engine).
 *
 * RESPONSIBILITY:
 * 1. Coordinates the complete computer vision pipeline.
 * 2. Manages UI event listeners, buttons, and telemetry cards.
 * 3. Drives the real-time inference loop using requestAnimationFrame.
 * 4. Renders live computer vision telemetry overlays (boxes, tags, gaze vectors) on the canvas.
 * 5. Applies and removes the CSS privacy shield blur on protected content.
 * 6. Manages the Security Audit Event Log.
 */

// --- Module Imports ---
// Each module encapsulates one concern of the system (camera, detection, recognition, etc.)
import { CONFIG } from './config.js';                        // Central configuration constants
import { CameraManager } from './camera.js';                 // Webcam access and stream lifecycle
import { FaceDetector } from './face-detection.js';          // TinyFaceDetector + 68-landmark model
import { FaceRecognizer } from './face-recognition.js';      // ResNet 128-d embedding + Euclidean matching
import { EnrollmentManager } from './enrollment.js';         // Multi-sample biometric enrollment flow
import { GazeEstimator } from './gaze-estimation.js';        // Yaw / pitch estimation from eye landmarks
import { SecurityDecisionEngine } from './security-engine.js'; // Threat classification state machine

class VisionGuardApp {
  constructor() {
    // -------------------------------------------------------------------------
    // 1. Initialize Subsystem Modules
    // Each subsystem is a self-contained class. Creating them here does NOT
    // start the camera or load any models yet — that happens in init() / startMonitoring().
    // -------------------------------------------------------------------------
    this.camera = new CameraManager();                        // Manages getUserMedia() webcam stream
    this.detector = new FaceDetector();                       // Wraps face-api.js TinyFaceDetector
    this.recognizer = new FaceRecognizer();                   // Wraps face-api.js ResNet for 128-d embeddings
    this.enrollment = new EnrollmentManager(this.recognizer); // Needs recognizer to generate descriptors during enrollment
    this.gazeEstimator = new GazeEstimator();                 // Stateless per-frame gaze analysis
    this.securityEngine = new SecurityDecisionEngine();       // Stateful threat-level state machine

    // -------------------------------------------------------------------------
    // 2. Runtime State
    // These flags control the inference loop and are mutated during the session.
    // -------------------------------------------------------------------------
    this.isMonitoring = false;       // True when the camera is active and inference is running
    this.animationFrameId = null;    // Stores the rAF handle so we can cancel it on stopMonitoring()
    this.lastInferenceTime = 0;      // Timestamp of the last AI inference call (used for throttling)
    this.fpsCounter = 0;             // Counts rAF ticks in the current second for FPS calculation
    this.fpsLastTime = performance.now(); // The start of the current 1-second FPS measurement window
    this.currentFps = 0;             // Displayed FPS (updated once per second)
    this.isModelsReady = false;      // Guard flag: prevents starting monitoring before weights are loaded
    this.eventCount = 0;             // Running count of audit log entries (shown in event log header)

    // -------------------------------------------------------------------------
    // 3. Cache DOM Elements
    // Querying the DOM repeatedly inside the rAF loop is expensive. We cache all
    // element references here once at construction so every later access is O(1).
    // -------------------------------------------------------------------------
    this.dom = {
      // --- Camera & Canvas ---
      // The <video> element receives the live MediaStream from the webcam.
      video: document.getElementById('camera-feed'),
      // The <canvas> is overlaid on top of the video and receives our CV drawings.
      canvas: document.getElementById('overlay-canvas'),
      // Placeholder graphic shown when the camera is not yet active.
      viewportPlaceholder: document.getElementById('viewport-placeholder'),
      // Small FPS counter tag rendered in the camera viewport corner.
      fpsTag: document.getElementById('camera-fps-tag'),

      // --- Controls ---
      // Start / Stop buttons toggle the monitoring session.
      btnStart: document.getElementById('btn-start-monitoring'),
      btnStop: document.getElementById('btn-stop-monitoring'),
      // Enroll triggers the multi-sample biometric capture modal.
      btnEnroll: document.getElementById('btn-enroll-user'),
      // Reset wipes the stored biometric descriptor from localStorage.
      btnResetEnrollment: document.getElementById('btn-reset-enrollment'),

      // --- Header Status ---
      // A pulsing colored dot gives an at-a-glance threat indicator.
      headerPulseDot: document.getElementById('header-pulse-dot'),
      // Short text label next to the pulse dot (e.g. "SAFE", "ALERT").
      headerStatusText: document.getElementById('header-status-text'),

      // --- Telemetry Cards ---
      // telemetryState: displays the current security state badge text.
      // telemetryReason: explains why the system is in that state.
      // NOTE: These are the canonical DOM references for the security-state elements.
      //       The duplicate aliases (telemetrySecurityState / telemetrySecurityReason)
      //       that previously existed in this block have been removed — they pointed to
      //       the same HTML element IDs and caused redundant DOM writes.
      telemetryState: document.getElementById('telemetry-security-state'),
      telemetryReason: document.getElementById('telemetry-security-reason'),
      // Number of faces currently detected in the frame.
      telemetryFaceCount: document.getElementById('telemetry-face-count'),
      // Subtext beneath face count (e.g. "1 face detected").
      telemetryFaceSubtext: document.getElementById('telemetry-face-subtext'),
      // Identity match verdict for the primary face (AUTHORIZED / UNCERTAIN / UNKNOWN).
      telemetryMatchStatus: document.getElementById('telemetry-match-status'),
      // Raw Euclidean distance for the best identity match (lower = more similar).
      telemetryMatchDistance: document.getElementById('telemetry-match-distance'),
      // Human-readable gaze state (e.g. "LOOKING AT SCREEN").
      telemetryGazeStatus: document.getElementById('telemetry-gaze-status'),
      // Numeric yaw and pitch angles from gaze estimation.
      telemetryGazeAngles: document.getElementById('telemetry-gaze-angles'),

      // --- Enrollment Profile Elements ---
      // Badge showing whether a biometric identity is stored (ENROLLED / NOT ENROLLED).
      enrollmentStatusBadge: document.getElementById('enrollment-status-badge'),
      // Displays the enrolled user's name.
      enrolledUserName: document.getElementById('enrolled-user-name'),
      // Shows the timestamp when the biometric template was created.
      enrolledUserDate: document.getElementById('enrolled-user-date'),

      // --- Event Log ---
      // Scrollable div that holds audit log <div> entries.
      eventLogContainer: document.getElementById('security-event-log'),
      // Counter badge showing total number of logged events.
      eventLogCount: document.getElementById('event-log-count'),

      // --- Protected Content & Privacy Shield Elements ---
      // The <section> that contains sensitive content blurred by the shield.
      protectedContent: document.getElementById('protected-content'),
      // A full-screen overlay div shown when PRIVACY_ALERT is active.
      alertOverlay: document.getElementById('privacy-alert-overlay'),
      // Human-readable explanation of why the alert was triggered.
      alertReasonText: document.getElementById('alert-reason-text'),
      // Counts the number of unauthorized viewers contributing to the alert.
      alertThreatCount: document.getElementById('alert-threat-count'),
      // Shows the wall-clock time when the most recent alert was raised.
      alertTimestamp: document.getElementById('alert-threat-timestamp'),

      // --- Modal Dialog Elements ---
      // The enrollment modal wraps the camera capture UI.
      modal: document.getElementById('enrollment-modal'),
      // Text input where the user enters the name for the enrolled identity.
      modalNameInput: document.getElementById('enrollment-name-input'),
      // Progress bar filled as each biometric sample is captured (0-100%).
      modalProgressBar: document.getElementById('enrollment-progress-bar'),
      // Text label showing the current enrollment step or instruction.
      modalStepText: document.getElementById('enrollment-step-text'),
      // Triggers the enrollment capture sequence.
      btnModalConfirm: document.getElementById('btn-confirm-enrollment'),
      // Cancels and closes the modal without saving.
      btnModalCancel: document.getElementById('btn-cancel-enrollment')
    };

    // Obtain the 2D drawing context from the overlay canvas once at startup.
    // All canvas drawing in renderVisualOverlays() will use this shared context.
    this.ctx = this.dom.canvas.getContext('2d');
  }

  /**
   * Application Entry Point
   *
   * Called once after DOMContentLoaded. Loads AI model weights into the browser
   * WebGL context (via face-api.js) and updates the UI to reflect readiness.
   * Model loading is asynchronous — until it completes, monitoring is blocked.
   */
  async init() {
    this.logEvent('INFO', 'Initializing VisionGuard client modules...');

    // Wire all button click handlers before anything else loads,
    // so the UI remains responsive even while models are downloading.
    this.bindEvents();

    // Reflect any previously saved enrollment in the UI card immediately.
    this.updateEnrollmentUI();

    try {
      // Inform the user that heavyweight model weights are being fetched / decoded.
      this.dom.headerStatusText.textContent = 'LOADING MODELS';
      this.dom.telemetryState.textContent = 'LOADING MODELS';
      this.dom.telemetryReason.textContent = 'Loading offline neural network weights from ./models';

      // Load the two AI models in parallel (they are independent files).
      // FaceDetector: TinyFaceDetector + 68-landmark model (~190 KB total).
      // FaceRecognizer: ResNet 128-d face embedding model (~6.2 MB).
      // Promise.all ensures we only proceed once BOTH are ready.
      await Promise.all([
        this.detector.loadModel(CONFIG.MODELS.BASE_PATH),
        this.recognizer.loadModel(CONFIG.MODELS.BASE_PATH)
      ]);

      // Both models loaded successfully — the system is ready.
      this.isModelsReady = true;
      this.dom.headerStatusText.textContent = 'READY';
      this.dom.telemetryState.textContent = 'READY';
      this.dom.telemetryState.className = 'badge-state state-idle';
      this.dom.telemetryReason.textContent = 'AI models loaded. Press Start Monitoring to begin.';
      this.logEvent('INFO', 'All neural network weights loaded into browser WebGL context.');
    } catch (err) {
      // Model loading failure (network error, missing file, WebGL crash).
      // We surface the raw error message so the developer can diagnose the cause.
      this.isModelsReady = false;
      this.dom.headerStatusText.textContent = 'MODEL ERROR';
      this.dom.telemetryState.textContent = 'MODEL ERROR';
      this.dom.telemetryState.className = 'badge-state state-alert'; // Red badge
      this.dom.telemetryReason.textContent = err.message;
      this.dom.headerPulseDot.className = 'pulse-dot pulse-alert';   // Red pulse
      this.logEvent('ALERT', `Model loading error: ${err.message}`);
      console.error('VisionGuard Initialization Error:', err);
    }
  }

  /**
   * Bind DOM Event Listeners
   *
   * Attaches click handlers to all interactive controls. Using arrow functions
   * preserves `this` context (the VisionGuardApp instance) without needing .bind().
   */
  bindEvents() {
    // Primary session controls
    this.dom.btnStart.addEventListener('click', () => this.startMonitoring());
    this.dom.btnStop.addEventListener('click', () => this.stopMonitoring());

    // Enrollment flow
    this.dom.btnEnroll.addEventListener('click', () => this.openEnrollmentModal());
    this.dom.btnResetEnrollment.addEventListener('click', () => this.resetEnrollment());

    // Modal controls — confirm runs the capture, cancel discards it
    this.dom.btnModalCancel.addEventListener('click', () => this.closeEnrollmentModal());
    this.dom.btnModalConfirm.addEventListener('click', () => this.executeEnrollment());

    // When the browser window is resized the CSS layout may change the
    // displayed size of the canvas. We must re-sync its internal pixel buffer
    // so drawn CV coordinates still align with the video pixels.
    window.addEventListener('resize', () => this.syncCanvasResolution());
  }

  /**
   * Start Live Camera Feed and Inference Loop
   *
   * Requests webcam access, syncs the canvas, resets the security engine,
   * and launches the rAF-driven inference loop. Any camera permission denial
   * or hardware failure is caught and surfaced to the user.
   */
  async startMonitoring() {
    // Block start if models haven't finished loading — running inference on
    // uninitialized models would throw cryptic errors deep inside face-api.js.
    if (!this.isModelsReady) {
      alert('Neural network models are still loading or encountered an error. Please wait.');
      return;
    }

    try {
      // Disable Start button immediately to prevent double-click race conditions.
      this.dom.btnStart.disabled = true;
      this.dom.telemetryReason.textContent = 'Requesting camera access...';

      // Ask the browser for the webcam stream. CameraManager handles
      // getUserMedia() and returns the negotiated {width, height} of the stream.
      const resolution = await this.camera.start(this.dom.video);

      // Sync the canvas pixel buffer to the actual stream resolution.
      // This MUST happen before any drawing calls, otherwise coordinates will be wrong.
      this.syncCanvasResolution(resolution.width, resolution.height);

      // Hide the placeholder graphic and reveal the live camera feed.
      this.dom.viewportPlaceholder.classList.add('hidden');
      this.dom.btnStop.disabled = false;
      this.isMonitoring = true;

      // Reset security engine counters: wipe frame confirmation buffers,
      // cooldown timers, and threat counters from any previous session.
      this.securityEngine.reset();

      // Update status UI to reflect active monitoring state.
      this.dom.headerStatusText.textContent = 'MONITORING';
      this.dom.telemetryState.textContent = 'MONITORING';
      this.dom.telemetryState.className = 'badge-state state-idle';
      this.dom.telemetryReason.textContent = 'Analyzing real-time video frames...';
      this.dom.headerPulseDot.className = 'pulse-dot pulse-safe';

      this.logEvent('INFO', `Camera feed active (${resolution.width}x${resolution.height}). Starting AI pipeline.`);

      // Kick off the requestAnimationFrame inference loop.
      // From this point forward, runInferenceLoop() self-schedules on each display refresh.
      this.runInferenceLoop();
    } catch (err) {
      // Camera error (permission denied, device in use, hardware failure).
      // Re-enable the Start button so the user can retry after resolving the issue.
      this.dom.btnStart.disabled = false;
      this.dom.btnStop.disabled = true;
      this.dom.headerStatusText.textContent = 'CAMERA ERROR';
      this.dom.telemetryState.textContent = 'CAMERA ERROR';
      this.dom.telemetryState.className = 'badge-state state-alert';
      this.dom.telemetryReason.textContent = err.message;
      this.dom.headerPulseDot.className = 'pulse-dot pulse-alert';
      this.logEvent('ALERT', `Camera failure: ${err.message}`);
      alert(`Camera Error:\n${err.message}`);
    }
  }

  /**
   * Stop Monitoring and Clean Up Resources
   *
   * Cancels the rAF loop, releases the camera MediaStream, clears the canvas,
   * resets the security engine, and returns the UI to its idle state.
   */
  stopMonitoring() {
    // Setting isMonitoring = false causes the next rAF callback to exit immediately,
    // effectively stopping the loop without needing to cancel it synchronously.
    this.isMonitoring = false;

    // Cancel any pending rAF tick to free the browser's animation scheduler slot.
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Release the camera MediaStream tracks — this turns off the webcam indicator light.
    this.camera.stop();

    // Wipe all CV drawings from the overlay canvas.
    this.clearCanvas();

    // Restore the placeholder image in the viewport.
    this.dom.viewportPlaceholder.classList.remove('hidden');

    // Swap button states: Start becomes available, Stop becomes unavailable.
    this.dom.btnStart.disabled = false;
    this.dom.btnStop.disabled = true;

    // Reset FPS display to zero.
    this.dom.fpsTag.textContent = '0 FPS';

    // Reset security engine back to INITIALIZING state so the next session starts clean.
    this.securityEngine.reset();

    // Update the security state card to show IDLE / stopped state.
    this.updateSecurityStateUI({
      state: 'IDLE',
      reason: 'Monitoring stopped by user.',
      shouldShieldBlur: false,
      threatLevel: 'NONE'
    });

    // Clear per-face telemetry fields back to empty placeholders.
    this.dom.telemetryFaceCount.textContent = '0';
    this.dom.telemetryFaceSubtext.textContent = 'Camera stopped';
    this.dom.telemetryMatchStatus.textContent = '--';
    this.dom.telemetryMatchDistance.textContent = 'Distance: --';
    this.dom.telemetryGazeStatus.textContent = '--';
    this.dom.telemetryGazeAngles.textContent = 'Yaw: -- | Pitch: --';

    this.logEvent('INFO', 'Monitoring terminated. Camera stream released.');
  }

  /**
   * Real-time Computer Vision Inference Loop
   *
   * This is the heart of VisionGuard's real-time processing. It uses the browser's
   * requestAnimationFrame (rAF) API, which calls the provided callback on every
   * display refresh (typically 60 Hz). The loop is therefore "display-synced" —
   * it runs as fast as the monitor refreshes, keeping the UI smooth.
   *
   * PATTERN EXPLANATION — requestAnimationFrame self-scheduling:
   *   1. runInferenceLoop() is first called by startMonitoring().
   *   2. At the end of each call it schedules *itself* as the next rAF callback:
   *        this.animationFrameId = requestAnimationFrame(() => this.runInferenceLoop());
   *   3. The browser calls the callback before painting the next frame.
   *   4. The loop continues until isMonitoring becomes false or cancelAnimationFrame() is called.
   *
   * WHY NOT setInterval?
   *   rAF automatically pauses when the tab is hidden (saving battery/CPU) and
   *   is synchronized with the display refresh, preventing tearing artifacts on canvas.
   *
   * WHY THROTTLE AI INFERENCE?
   *   At 60 Hz each frame is only ~16 ms apart, but a full AI pipeline call
   *   (detection + recognition + gaze) takes 50–200 ms depending on hardware.
   *   Running inference every rAF tick would saturate the CPU/GPU and cause the
   *   browser UI thread to freeze, making the page unresponsive.
   *   CONFIG.SECURITY.INFERENCE_INTERVAL_MS (default: 110 ms ≈ ~9 Hz) is a
   *   deliberate throttle: fast enough for real-time response, slow enough to
   *   keep CPU usage reasonable and the UI thread free.
   *
   * The FPS counter tracks rAF ticks (not inference calls) so it reflects the
   * actual rendering frame rate, not the AI throughput.
   */
  async runInferenceLoop() {
    // Exit immediately if monitoring was stopped while this callback was queued.
    if (!this.isMonitoring) return;

    const now = performance.now(); // High-resolution timestamp in milliseconds

    // --- FPS Telemetry ---
    // Count every rAF tick regardless of whether inference runs this tick.
    this.fpsCounter++;
    if (now - this.fpsLastTime >= 1000) {
      // One second has elapsed — freeze the counter as the displayed FPS value.
      this.currentFps = this.fpsCounter;
      this.fpsCounter = 0;        // Reset for the next one-second window
      this.fpsLastTime = now;     // Start a new one-second measurement window
      this.dom.fpsTag.textContent = `${this.currentFps} FPS`;
    }

    // --- Inference Throttling ---
    // Only run the expensive AI pipeline if enough time has passed since the last call.
    // This prevents the CPU/GPU from being hammered at 60 Hz with heavyweight tensor ops.
    if (now - this.lastInferenceTime >= CONFIG.SECURITY.INFERENCE_INTERVAL_MS) {
      this.lastInferenceTime = now; // Record this inference start time for the next throttle check
      await this.processVideoFrame(); // Run the full 4-stage CV pipeline on this frame
    }

    // Schedule the next tick AFTER the await above, so we don't stack up concurrent calls.
    // If processVideoFrame() took 120 ms and rAF ticks every 16 ms, 7 "display-only"
    // ticks ran during that time — the FPS counter reflects them, but no extra AI was run.
    this.animationFrameId = requestAnimationFrame(() => this.runInferenceLoop());
  }

  /**
   * Process a single video frame through the AI pipeline
   *
   * This is the 4-stage pipeline that transforms a raw video frame into a
   * security decision. The stages are intentionally sequential because each stage
   * depends on the output of the previous one:
   *
   *   STAGE 1 — DETECT: Find faces and extract 68 facial landmarks + 128-d ResNet embedding.
   *   STAGE 2 — RECOGNIZE: For each face, compute identity match vs enrolled user
   *             AND estimate head gaze direction (yaw / pitch).
   *   STAGE 3 — SECURITY DECISION: Feed all face analyses into the state machine
   *             which applies temporal confirmation rules and returns a threat report.
   *   STAGE 4 — RENDER: Update the canvas overlay, telemetry cards, and privacy shield.
   */
  async processVideoFrame() {
    // Guard: skip if the camera stream ended or the video element has no data yet.
    // readyState < 2 means the browser hasn't decoded any frames (HAVE_CURRENT_DATA = 2).
    if (!this.camera.isActive() || this.dom.video.readyState < 2) {
      return;
    }

    // Retrieve the enrolled biometric descriptor from localStorage (null if none saved).
    const enrolledUser = this.enrollment.getEnrolledUser();
    const enrolledDescriptor = enrolledUser ? enrolledUser.descriptor : null; // Float32Array[128] or null
    const hasEnrolledUser = !!enrolledDescriptor; // Boolean flag for the security engine

    try {
      // =====================================================================
      // STAGE 1: Face Detection & 68 Landmarks & 128-d Recognition Embeddings
      // =====================================================================
      // extractFacesWithDescriptors() runs TinyFaceDetector to locate faces,
      // then passes each detection through the 68-landmark model and the ResNet
      // embedding network. This single call returns everything we need for
      // identity matching and gaze estimation.
      const detectedFaces = await this.recognizer.extractFacesWithDescriptors(
        this.dom.video,              // Source: live video element (decoded current frame)
        this.detector.detectorOptions // TinyFaceDetector config (input size, score threshold)
      );

      // =====================================================================
      // STAGE 2: Identity Matching & Gaze Estimation Per Face
      // =====================================================================
      // We iterate over every detected face and enrich it with two additional
      // analyses: who is this person (matchResult) and where are they looking (gazeResult).
      const analyzedFaces = [];

      for (let i = 0; i < detectedFaces.length; i++) {
        const item = detectedFaces[i];
        const detBox = item.detection.box;      // Bounding box {x, y, width, height} in pixel coords
        const score = item.detection.score || 0; // Detection confidence in [0,1] from the detector
        const landmarks = item.landmarks;        // 68 facial landmark points (face-api FaceLandmarks68)
        const descriptor = item.descriptor;      // Float32Array[128] — the ResNet face embedding

        // --- Identity Matching (Member 1) ---
        // Computes Euclidean distance between this descriptor and the enrolled template.
        // Returns { matchStatus: 'AUTHORIZED'|'UNCERTAIN'|'UNKNOWN', distance, confidencePercent }.
        const matchResult = this.recognizer.matchDescriptor(descriptor, enrolledDescriptor);

        // --- Gaze & Head Pose Estimation (Member 2) ---
        // Uses eye landmark indices 36-47, nose tip (30), and chin (8) to estimate
        // yaw (left/right rotation) and pitch (up/down tilt) of the head.
        // Returns { gazeState, isLookingAtScreen, yawDeg, pitchDeg, ... }.
        const gazeResult = this.gazeEstimator.estimateGaze(landmarks, i, score);

        // Build a unified per-face analysis object for the security engine and renderer.
        analyzedFaces.push({
          box: {
            x: detBox.x,
            y: detBox.y,
            width: detBox.width,
            height: detBox.height
          },
          score,
          landmarks,
          descriptor,
          matchResult,
          gazeResult
        });
      }

      // =====================================================================
      // STAGE 3: Security Decision Engine Evaluation (Member 2)
      // =====================================================================
      // The engine receives the full scene description and applies temporal
      // confirmation rules (N consecutive suspicious frames required) before
      // escalating to PRIVACY_ALERT. It also manages the recovery cooldown.
      const securityReport = this.securityEngine.evaluateFrame({
        faces: analyzedFaces,
        hasEnrolledUser,
        isCameraActive: this.camera.isActive(),
        isModelLoaded: this.isModelsReady
      });

      // =====================================================================
      // STAGE 4: Update Dashboard Telemetry & Overlays (Member 3)
      // =====================================================================
      // Update the numeric / text telemetry cards (face count, match status, gaze angles).
      this.updateTelemetryUI(analyzedFaces, securityReport, enrolledUser);

      // Render CV overlays (bounding boxes, gaze rays, corner brackets) on the canvas.
      // Wrapped in its own try/catch so a canvas rendering glitch doesn't kill the loop.
      try {
        this.renderVisualOverlays(analyzedFaces, securityReport);
      } catch (renderErr) {
        // Non-fatal: log a warning and continue the loop.
        console.warn('VisionGuard Overlay Rendering Notice:', renderErr);
      }

      // Apply or remove the privacy shield blur based on the security report.
      this.updateSecurityStateUI(securityReport, analyzedFaces);

      // Log a state-change event to the audit trail whenever the engine changes state.
      if (securityReport.stateChanged) {
        // Choose log severity based on the new state.
        const logType =
          securityReport.state === CONFIG.SECURITY.STATES.PRIVACY_ALERT
            ? 'ALERT'
            : securityReport.state === CONFIG.SECURITY.STATES.CAUTION
            ? 'CAUTION'
            : securityReport.state === CONFIG.SECURITY.STATES.SAFE
            ? 'SAFE'
            : 'INFO';

        this.logEvent(logType, `State: ${securityReport.state} - ${securityReport.reason}`);
      }
    } catch (err) {
      // Catch-all for unexpected inference errors (e.g. WebGL context loss).
      // We log a warning but do NOT rethrow — the loop must continue running.
      console.warn('VisionGuard Frame Processing Warning:', err);
    }
  }

  /**
   * Renders Computer Vision Overlays (Bounding Boxes, Tags, Gaze Rays) on Canvas
   *
   * The canvas is a transparent element overlaid pixel-for-pixel on the <video>.
   * We draw color-coded bounding boxes, identity labels, eye landmarks, and a
   * gaze direction ray for every detected face.
   *
   * WHY THE CANVAS MUST SYNC WITH VIDEO DIMENSIONS:
   * A <canvas> element has two separate size concepts:
   *   - CSS size: how large the element appears on screen (set by CSS).
   *   - Internal buffer size: canvas.width × canvas.height in actual pixels.
   * If the internal buffer does not match the video's natural resolution, all
   * drawn coordinates will be scaled/stretched incorrectly. For example, if
   * face-api.js reports a bounding box at pixel (320, 240) but the canvas
   * internal buffer is half the video resolution, the box would be drawn at
   * the wrong screen position. syncCanvasResolution() fixes this.
   *
   * @param {Array} analyzedFaces - Per-face analysis objects from processVideoFrame()
   * @param {Object} securityReport - Current threat report from the security engine
   */
  renderVisualOverlays(analyzedFaces, securityReport) {
    // Re-acquire the 2D context in case it was lost (e.g. GPU process crash on mobile).
    if (!this.ctx) {
      this.ctx = this.dom.canvas.getContext('2d');
    }

    // If the video's natural resolution changed (e.g. stream renegotiated after resize),
    // re-sync the canvas buffer before drawing to avoid coordinate misalignment.
    if (
      this.dom.video.videoWidth > 0 &&
      (this.dom.canvas.width !== this.dom.video.videoWidth || this.dom.canvas.height !== this.dom.video.videoHeight)
    ) {
      this.syncCanvasResolution(this.dom.video.videoWidth, this.dom.video.videoHeight);
    }

    // Clear any drawings from the previous frame before painting the new frame's overlays.
    this.clearCanvas();
    const ctx = this.ctx;
    const width = this.dom.canvas.width;   // Canvas internal pixel width (matches video)
    const height = this.dom.canvas.height; // Canvas internal pixel height (matches video)

    // Nothing to draw if there are no faces detected this frame.
    if (!ctx || analyzedFaces.length === 0) return;

    // Iterate over each detected and analyzed face to draw its overlay elements.
    for (let i = 0; i < analyzedFaces.length; i++) {
      const face = analyzedFaces[i];
      const box = face.box;           // Bounding box pixel coordinates
      const match = face.matchResult; // Identity verdict from the recognizer
      const gaze = face.gazeResult;   // Gaze state from the gaze estimator

      // -----------------------------------------------------------------------
      // Color coding based on identity and gaze threat:
      //   AUTHORIZED         → Cyan   (trusted, no threat)
      //   UNAUTHORIZED + looking at screen → Bright Red (active threat)
      //   UNAUTHORIZED + looking away      → Amber/Orange (presence, no immediate threat)
      // -----------------------------------------------------------------------
      let strokeColor = CONFIG.UI.CANVAS_COLORS.UNKNOWN_UNCERTAIN; // Default: amber
      let labelText = 'UNKNOWN';

      if (match.matchStatus === 'AUTHORIZED') {
        strokeColor = CONFIG.UI.CANVAS_COLORS.AUTHORIZED; // Cyan — trusted identity confirmed
        labelText = `AUTHORIZED: ${match.confidencePercent}%`;
      } else if (gaze.gazeState === CONFIG.GAZE.STATES.LOOKING_AT_SCREEN) {
        strokeColor = CONFIG.UI.CANVAS_COLORS.UNAUTHORIZED_ALERT; // Bright Red — active threat
        labelText = `THREAT: LOOKING AT SCREEN`;
      } else {
        strokeColor = CONFIG.UI.CANVAS_COLORS.UNAUTHORIZED_SAFE; // Amber — present but not looking
        labelText = `UNAUTHORIZED (Away)`;
      }

      // -----------------------------------------------------------------------
      // Draw the main bounding box rectangle around the detected face.
      // -----------------------------------------------------------------------
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(box.x, box.y, box.width, box.height); // Simple rectangle outline

      // Draw decorative corner brackets (cyber-aesthetic) overlaid on the box corners.
      // These are drawn on top of the rectangle so they "frame" the face distinctively.
      this.drawCyberBrackets(ctx, box.x, box.y, box.width, box.height, strokeColor);

      // -----------------------------------------------------------------------
      // Draw label background pill above the bounding box.
      // We measure the text width first so the pill is exactly the right size.
      // -----------------------------------------------------------------------
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(labelText).width; // Pixel width of the label string
      const pillHeight = 20;                              // Fixed height for the label pill
      const pillY = Math.max(0, box.y - pillHeight - 4); // Position pill above the box; clamp at 0

      // Dark semi-transparent background for readability over any video content.
      ctx.fillStyle = 'rgba(7, 11, 20, 0.85)';
      ctx.fillRect(box.x, pillY, textWidth + 14, pillHeight);

      // Colored border around the pill, matching the face's threat color.
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, pillY, textWidth + 14, pillHeight);

      // Draw the label text in the matching threat color.
      ctx.fillStyle = strokeColor;
      ctx.fillText(labelText, box.x + 7, pillY + 14); // 7px left pad, 14px baseline from pill top

      // -----------------------------------------------------------------------
      // Draw eye landmark dots and gaze direction ray.
      // -----------------------------------------------------------------------
      if (face.landmarks && face.landmarks.positions) {
        // Draw small dot markers at each of the 12 eye landmark points.
        // Left eye occupies landmark indices 36–41, right eye 42–47 (68-point model convention).
        ctx.fillStyle = CONFIG.UI.CANVAS_COLORS.LANDMARKS; // Subtle landmark color (e.g. light blue)
        for (let p = 36; p <= 47; p++) {
          const pt = face.landmarks.positions[p];
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.8, 0, 2 * Math.PI); // 1.8px radius dot
          ctx.fill();
        }

        // -----------------------------------------------------------------------
        // Draw Gaze Direction Ray from the nose tip (landmark point 30).
        // WHY from the nose tip? It's the most stable central facial reference point.
        // The ray is projected using the estimated yaw and pitch angles converted to radians.
        // A red ray indicates the person is looking at the screen (threat).
        // A cyan ray indicates they are looking away (safe or caution).
        // -----------------------------------------------------------------------
        const nose = face.landmarks.positions[30]; // Nose tip — anatomically stable anchor
        const rayLength = 40; // Length of the projected gaze ray in canvas pixels

        // Convert estimated degrees to radians for use in Math.sin() / Math.cos().
        const yawRad = (gaze.yawDeg * Math.PI) / 180;
        const pitchRad = (gaze.pitchDeg * Math.PI) / 180;

        // Project the ray endpoint from the nose tip using the gaze angles.
        // sin(yaw) gives horizontal displacement; sin(pitch) gives vertical displacement.
        const endX = nose.x + Math.sin(yawRad) * rayLength;
        const endY = nose.y + Math.sin(pitchRad) * rayLength;

        // Draw the ray line from nose tip to projected endpoint.
        ctx.beginPath();
        ctx.moveTo(nose.x, nose.y);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = gaze.isLookingAtScreen ? '#ff1744' : '#00e5ff'; // Red = threat, Cyan = safe
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw a small filled circle at the ray endpoint to visually anchor it.
        ctx.beginPath();
        ctx.arc(endX, endY, 3, 0, 2 * Math.PI); // 3px radius terminus dot
        ctx.fillStyle = gaze.isLookingAtScreen ? '#ff1744' : '#00e5ff';
        ctx.fill();
      }
    }
  }

  /**
   * Draw high-tech corner brackets around bounding box
   *
   * Instead of drawing the full 4-sided rectangle (which strokeRect handles),
   * this function draws only the L-shaped corner portions of the rectangle.
   * This "cyber bracket" aesthetic is a common visual design in AI/security UIs
   * because it frames the subject without visually obscuring the face area.
   *
   * HOW IT WORKS:
   *   For each corner we draw two line segments that form an "L" shape:
   *   one horizontal segment and one vertical segment, each 'bLen' pixels long.
   *   bLen is capped at min(14, 20% of face width) so small faces still look good.
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas 2D context to draw onto
   * @param {number} x - Left edge of the bounding box (pixels)
   * @param {number} y - Top edge of the bounding box (pixels)
   * @param {number} w - Width of the bounding box (pixels)
   * @param {number} h - Height of the bounding box (pixels)
   * @param {string} color - CSS color string for the bracket stroke
   */
  drawCyberBrackets(ctx, x, y, w, h, color) {
    // Bracket arm length: at most 14px, or 20% of face width for small faces.
    const bLen = Math.min(14, w * 0.2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3; // Thicker than the main rect for visual emphasis

    // --- Top-left corner ---
    // Draw from (x, y+bLen) up to (x, y) then right to (x+bLen, y).
    ctx.beginPath();
    ctx.moveTo(x, y + bLen); ctx.lineTo(x, y); ctx.lineTo(x + bLen, y);
    ctx.stroke();

    // --- Top-right corner ---
    // Draw from (x+w-bLen, y) right to (x+w, y) then down to (x+w, y+bLen).
    ctx.beginPath();
    ctx.moveTo(x + w - bLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + bLen);
    ctx.stroke();

    // --- Bottom-left corner ---
    // Draw from (x, y+h-bLen) down to (x, y+h) then right to (x+bLen, y+h).
    ctx.beginPath();
    ctx.moveTo(x, y + h - bLen); ctx.lineTo(x, y + h); ctx.lineTo(x + bLen, y + h);
    ctx.stroke();

    // --- Bottom-right corner ---
    // Draw from (x+w-bLen, y+h) right to (x+w, y+h) then up to (x+w, y+h-bLen).
    ctx.beginPath();
    ctx.moveTo(x + w - bLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - bLen);
    ctx.stroke();
  }

  /**
   * Update Dashboard Telemetry Metrics
   *
   * Writes per-frame face count, identity match verdict, and gaze angles
   * into the telemetry card elements. When no faces are detected all fields
   * are set to placeholder text ("--") to avoid stale data being displayed.
   *
   * @param {Array} analyzedFaces - Per-face analysis objects
   * @param {Object} report - Security engine report
   * @param {Object|null} enrolledUser - Enrolled user record from localStorage (null if none)
   */
  updateTelemetryUI(analyzedFaces, report, enrolledUser) {
    const faceCount = analyzedFaces.length; // Total number of faces detected this frame
    this.dom.telemetryFaceCount.textContent = faceCount.toString();

    // If no faces detected, reset all dependent telemetry fields to empty state.
    if (faceCount === 0) {
      this.dom.telemetryFaceSubtext.textContent = 'No face in frame';
      this.dom.telemetryMatchStatus.textContent = '--';
      this.dom.telemetryMatchDistance.textContent = 'Distance: --';
      this.dom.telemetryGazeStatus.textContent = '--';
      this.dom.telemetryGazeAngles.textContent = 'Yaw: -- | Pitch: --';
      return; // No further telemetry to display
    }

    // Grammatically correct subtext: "1 face detected" vs "N faces detected".
    this.dom.telemetryFaceSubtext.textContent =
      faceCount === 1 ? '1 face detected' : `${faceCount} faces detected`;

    // Show telemetry for the primary face (index 0 = first detected, typically the largest/closest).
    const primaryFace = analyzedFaces[0];
    const match = primaryFace.matchResult; // Identity match result for the dominant face
    const gaze = primaryFace.gazeResult;   // Gaze analysis result for the dominant face

    // --- Identity telemetry ---
    if (!enrolledUser) {
      // No enrolled template: system cannot perform identity verification.
      this.dom.telemetryMatchStatus.textContent = 'NOT ENROLLED';
      this.dom.telemetryMatchDistance.textContent = 'Enroll user to verify';
    } else {
      // Show match verdict and percentage confidence side by side.
      this.dom.telemetryMatchStatus.textContent = `${match.matchStatus} (${match.confidencePercent}%)`;
      // Euclidean distance is the raw similarity metric: 0 = identical, >0.64 = unknown.
      this.dom.telemetryMatchDistance.textContent = `Distance: ${match.distance}`;
    }

    // --- Gaze telemetry ---
    // Convert underscore enum string (LOOKING_AT_SCREEN) to spaced label for readability.
    this.dom.telemetryGazeStatus.textContent = gaze.gazeState.replace(/_/g, ' ');
    // Display numeric angles rounded to configured decimal places.
    this.dom.telemetryGazeAngles.textContent = `Yaw: ${gaze.yawDeg}° | Pitch: ${gaze.pitchDeg}°`;
  }

  /**
   * Update Security Engine State & Trigger Privacy Shield
   *
   * Reflects the current security state in the header and telemetry badge,
   * and applies/removes the CSS blur shield on the protected content section.
   *
   * The privacy shield is a CSS class ("shield-active") that applies a heavy
   * backdrop-filter blur to the protected content element. The blur is activated
   * whenever report.shouldShieldBlur is true (i.e. during PRIVACY_ALERT and
   * its recovery cooldown period).
   *
   * @param {Object} report - Security engine report (state, reason, shouldShieldBlur, etc.)
   * @param {Array} analyzedFaces - Per-face analysis objects (used to count active threats)
   */
  updateSecurityStateUI(report, analyzedFaces = []) {
    const state = report.state;

    // Update the security state badge text and the header label.
    // Replace underscores with spaces: "PRIVACY_ALERT" → "PRIVACY ALERT".
    this.dom.telemetryState.textContent = state.replace(/_/g, ' ');
    this.dom.telemetryReason.textContent = report.reason;
    this.dom.headerStatusText.textContent = state.replace(/_/g, ' ');

    // --- State badge CSS class and pulse dot class ---
    // Each security state has a corresponding color theme applied via CSS classes.
    let badgeClass = 'badge-state state-idle'; // Default: grey/neutral
    let pulseClass = 'pulse-dot';              // Default: no pulse color

    if (state === CONFIG.SECURITY.STATES.SAFE) {
      badgeClass = 'badge-state state-safe';     // Green badge
      pulseClass = 'pulse-dot pulse-safe';       // Green pulse
    } else if (state === CONFIG.SECURITY.STATES.CAUTION) {
      badgeClass = 'badge-state state-caution';  // Orange/amber badge
      pulseClass = 'pulse-dot pulse-caution';    // Orange pulse
    } else if (state === CONFIG.SECURITY.STATES.PRIVACY_ALERT) {
      badgeClass = 'badge-state state-alert';    // Red badge — maximum threat
      pulseClass = 'pulse-dot pulse-alert';      // Rapid red pulse
    } else if (state === CONFIG.SECURITY.STATES.CAMERA_ERROR || state === CONFIG.SECURITY.STATES.MODEL_ERROR) {
      badgeClass = 'badge-state state-alert';    // Red badge — hardware/software failure
      pulseClass = 'pulse-dot pulse-alert';      // Red pulse for errors too
    } else {
      badgeClass = 'badge-state state-idle';     // Idle / initializing / no-user states
      pulseClass = 'pulse-dot';                  // No color class — neutral grey dot
    }

    this.dom.telemetryState.className = badgeClass;
    this.dom.headerPulseDot.className = pulseClass;

    // -----------------------------------------------------------------------
    // CRITICAL REQUIREMENT: Trigger Webpage-Level Privacy Shield Blur
    //
    // report.shouldShieldBlur is true when the security engine is in
    // PRIVACY_ALERT state OR during the recovery cooldown window.
    // Adding "shield-active" to the protectedContent element triggers the CSS
    // blur filter. The alertOverlay is shown simultaneously to explain the event.
    // -----------------------------------------------------------------------
    if (report.shouldShieldBlur) {
      // Activate blur shield on the sensitive content area.
      this.dom.protectedContent.classList.add('shield-active');

      // Show the full-screen warning overlay so the user knows why content is blurred.
      this.dom.alertOverlay.classList.add('visible');

      // Explain the specific threat detected.
      this.dom.alertReasonText.textContent = report.reason;

      // Count faces that are both unauthorized AND actively looking at the screen.
      // These are the actual threat contributors (not just bystanders looking away).
      const threatCount = analyzedFaces.filter(
        (f) =>
          f.matchResult.matchStatus !== 'AUTHORIZED' &&
          f.gazeResult.gazeState === CONFIG.GAZE.STATES.LOOKING_AT_SCREEN
      ).length;

      // Show the threat count; fall back to 1 even if zero faces match (edge case during cooldown).
      this.dom.alertThreatCount.textContent = `Threat: ${threatCount || 1} Unauthorized Viewer`;
      // Timestamp when the most recent shield activation occurred.
      this.dom.alertTimestamp.textContent = `Alert: ${new Date().toLocaleTimeString()}`;
    } else {
      // No active threat — remove the blur and hide the overlay.
      this.dom.protectedContent.classList.remove('shield-active');
      this.dom.alertOverlay.classList.remove('visible');
    }
  }

  /**
   * Append Entry to Security Audit Log
   *
   * Prepends a new log entry at the top of the event log container so the most
   * recent events are always visible without scrolling. Trims old entries that
   * exceed CONFIG.SECURITY.MAX_EVENT_LOG_ENTRIES to prevent memory growth.
   *
   * @param {'INFO'|'SAFE'|'CAUTION'|'ALERT'} type - Severity level (maps to CSS class)
   * @param {string} message - Human-readable event description
   */
  logEvent(type, message) {
    this.eventCount++; // Increment the global event counter for the badge display
    this.dom.eventLogCount.textContent = `${this.eventCount} events`;

    // Create a new log entry div with the appropriate severity CSS class.
    const item = document.createElement('div');
    item.className = `event-log-item log-${type.toLowerCase()}`; // e.g. "log-alert", "log-info"

    const timeStr = new Date().toLocaleTimeString(); // Wall-clock time for auditing purposes

    // Build the log row: timestamp | severity badge | message text.
    // title attribute on the message enables the full text on hover (useful for truncated msgs).
    item.innerHTML = `
      <span class="log-time">${timeStr}</span>
      <span class="log-badge">${type}</span>
      <span class="log-msg" title="${message}">${message}</span>
    `;

    // Prepend so the newest entry appears at the top of the log container.
    this.dom.eventLogContainer.prepend(item);

    // Trim the log to the configured maximum length.
    // We remove from the bottom (oldest entries) to stay within the entry budget.
    while (this.dom.eventLogContainer.children.length > CONFIG.SECURITY.MAX_EVENT_LOG_ENTRIES) {
      this.dom.eventLogContainer.removeChild(this.dom.eventLogContainer.lastChild);
    }
  }

  /**
   * Update Enrollment UI Card
   *
   * Reflects whether a biometric identity is stored in localStorage.
   * Called at startup and after any enrollment or reset operation.
   */
  updateEnrollmentUI() {
    const enrolled = this.enrollment.getEnrolledUser(); // Returns stored user record or null
    if (enrolled) {
      // A biometric template exists — show the user's name and enrollment timestamp.
      this.dom.enrollmentStatusBadge.textContent = 'ENROLLED';
      this.dom.enrollmentStatusBadge.className = 'badge-state state-safe'; // Green badge
      this.dom.enrolledUserName.textContent = enrolled.name;

      // Format the ISO timestamp into a human-readable local date+time string.
      const enrolledDate = new Date(enrolled.enrolledAt);
      this.dom.enrolledUserDate.textContent = `Enrolled: ${enrolledDate.toLocaleDateString()} ${enrolledDate.toLocaleTimeString()}`;
      this.dom.btnResetEnrollment.disabled = false; // Allow deletion if enrolled
    } else {
      // No biometric template stored — guide the user to enroll.
      this.dom.enrollmentStatusBadge.textContent = 'NOT ENROLLED';
      this.dom.enrollmentStatusBadge.className = 'badge-state state-idle'; // Grey badge
      this.dom.enrolledUserName.textContent = 'No User Enrolled';
      this.dom.enrolledUserDate.textContent = 'Biometric template missing';
      this.dom.btnResetEnrollment.disabled = true; // Nothing to reset
    }
  }

  /**
   * Reset / Delete Enrolled User
   *
   * Prompts the user for confirmation (irreversible action) then wipes the
   * biometric descriptor from localStorage and updates the enrollment UI card.
   */
  resetEnrollment() {
    // Confirmation dialog prevents accidental deletion of the enrolled identity.
    if (confirm('Are you sure you want to delete the enrolled biometric identity?')) {
      this.enrollment.deleteEnrollment(); // Removes the stored Float32Array descriptor
      this.updateEnrollmentUI();          // Reflect the now-empty enrollment state in the UI
      this.logEvent('INFO', 'Enrolled biometric template deleted by user.');
    }
  }

  /**
   * Open Enrollment Modal
   *
   * Shows the enrollment dialog. If the camera isn't active yet, starts it
   * first so the user can position their face before capturing samples.
   * Guards against opening the modal when models are still loading.
   */
  async openEnrollmentModal() {
    // Cannot enroll without the ResNet model loaded (we need it to generate descriptors).
    if (!this.isModelsReady) {
      alert('Models are still initializing. Please wait.');
      return;
    }

    // If the camera isn't running, start it so the user can see themselves.
    // This allows enrollment without first clicking "Start Monitoring".
    if (!this.camera.isActive()) {
      try {
        await this.camera.start(this.dom.video);
        this.syncCanvasResolution(); // Sync canvas to the newly started stream's resolution
        this.dom.viewportPlaceholder.classList.add('hidden');
        this.dom.btnStop.disabled = false;
        this.dom.btnStart.disabled = true;
        this.isMonitoring = true;
        this.runInferenceLoop(); // Run inference loop so the user can see CV overlays during enrollment
      } catch (err) {
        alert(`Cannot start enrollment: Camera could not be started.\n${err.message}`);
        return;
      }
    }

    // Reset the progress bar and instruction text for a fresh enrollment session.
    this.dom.modalProgressBar.style.width = '0%';
    this.dom.modalStepText.textContent = 'Position your face in camera view and click "Start Capture".';
    this.dom.btnModalConfirm.disabled = false;

    // Add the "open" class to the modal to make it visible (CSS transition handles the animation).
    this.dom.modal.classList.add('open');
  }

  /**
   * Close Enrollment Modal
   *
   * Hides the enrollment dialog by removing the "open" CSS class.
   * Does not stop the camera or inference loop — monitoring continues in the background.
   */
  closeEnrollmentModal() {
    this.dom.modal.classList.remove('open');
  }

  /**
   * Execute Multi-Sample Biometric Enrollment
   *
   * Calls EnrollmentManager.enrollFromVideo() which captures N frames,
   * averages the ResNet descriptors, L2-normalizes the result, and stores it
   * in localStorage. A progress callback updates the modal UI on each sample.
   *
   * WHY MULTI-SAMPLE?
   *   A single frame may contain motion blur, partial occlusion, or unusual lighting.
   *   Averaging multiple samples (CONFIG.ENROLLMENT.SAMPLE_COUNT) reduces this noise
   *   and produces a more robust biometric template.
   */
  async executeEnrollment() {
    // Use entered name or fall back to a default label if the field was left blank.
    const userName = this.dom.modalNameInput.value.trim() || 'Authorized User';

    // Disable confirm button during capture to prevent duplicate enrollment requests.
    this.dom.btnModalConfirm.disabled = true;

    try {
      await this.enrollment.enrollFromVideo(
        this.dom.video,               // Source video element (live camera feed)
        this.detector.detectorOptions, // Detector config (must match what inference uses)
        userName,                      // Name to store alongside the biometric template
        (progress) => {
          // Progress callback: fired after each sample is captured.
          // progress.step = current sample index, progress.total = total samples needed.
          const percent = Math.round((progress.step / progress.total) * 100);
          this.dom.modalProgressBar.style.width = `${percent}%`; // Animate progress bar
          this.dom.modalStepText.textContent = progress.message;  // Update instruction text
        }
      );

      // Enrollment complete — refresh the enrollment card to show the new user.
      this.updateEnrollmentUI();
      this.logEvent('SAFE', `Authorized identity '${userName}' successfully enrolled.`);

      // Auto-close the modal after a short delay so the user can see the success state.
      setTimeout(() => {
        this.closeEnrollmentModal();
      }, 1200);
    } catch (err) {
      // Enrollment failed (no face detected, low confidence, camera error).
      // Show the error in the modal and re-enable the button for retry.
      this.dom.modalStepText.textContent = `Error: ${err.message}`;
      this.dom.btnModalConfirm.disabled = false;
      this.logEvent('ALERT', `Enrollment failed: ${err.message}`);
    }
  }

  /**
   * Synchronize overlay canvas dimensions with video element
   *
   * Sets the canvas's internal pixel buffer (canvas.width, canvas.height) to
   * match the video stream's natural resolution (or the provided w/h values).
   *
   * This is CRITICAL for coordinate accuracy: face-api.js reports bounding boxes
   * in the video's natural pixel coordinates. If the canvas buffer is a different
   * size, all drawn elements would be offset or scaled incorrectly.
   *
   * Called:
   *   - Once after the camera stream starts (actual stream resolution).
   *   - On window resize (layout can change the canvas's displayed size).
   *   - During rendering if a mid-session resolution change is detected.
   *
   * @param {number} [w] - Desired canvas pixel width (falls back to video or config default)
   * @param {number} [h] - Desired canvas pixel height (falls back to video or config default)
   */
  syncCanvasResolution(w, h) {
    // Prefer the explicitly passed dimensions, then the video's current natural resolution,
    // then the configured default (in case video dimensions aren't available yet).
    const videoWidth = w || this.dom.video.videoWidth || CONFIG.CAMERA.DEFAULT_WIDTH;
    const videoHeight = h || this.dom.video.videoHeight || CONFIG.CAMERA.DEFAULT_HEIGHT;

    // Assign directly to canvas.width / canvas.height (not via CSS) to set the
    // internal pixel buffer dimensions. Assigning to these clears the canvas automatically.
    this.dom.canvas.width = videoWidth;
    this.dom.canvas.height = videoHeight;
  }

  /**
   * Clear canvas overlay
   *
   * Erases all drawings from the overlay canvas by clearing the entire buffer.
   * Called at the start of each render frame and when monitoring stops.
   */
  clearCanvas() {
    // clearRect(x, y, width, height) fills the specified rectangle with transparent pixels.
    // Using 0,0 to full canvas dimensions clears everything drawn in the previous frame.
    this.ctx.clearRect(0, 0, this.dom.canvas.width, this.dom.canvas.height);
  }
}

// Bootstrap Application on DOM Ready
// We wait for DOMContentLoaded so all HTML elements are in the document before
// the constructor runs and queries them with getElementById().
document.addEventListener('DOMContentLoaded', () => {
  const app = new VisionGuardApp();
  app.init().catch((err) => console.error('App Bootstrap Error:', err));

  // Expose the app instance on window for browser console inspection and debugging.
  // e.g. window.VisionGuard.securityEngine.getMetrics()
  window.VisionGuard = app;
});
