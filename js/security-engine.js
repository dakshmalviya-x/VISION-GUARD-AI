/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Security Decision Engine (js/security-engine.js)
 *
 * Maintained primarily by Member 2 (Gaze Estimation and Security Decision Engine)
 *
 * RESPONSIBILITY:
 * 1. Consumes per-frame outputs from Face Detection, Face Recognition, and Gaze Estimation.
 * 2. Applies deterministic heuristic rules to determine current threat level.
 * 3. Enforces multi-frame temporal confirmation windows to eliminate false positives.
 * 4. Implements anti-flicker hysteresis and cooldown timers during recovery.
 * 5. Manages state transitions: SAFE, CAUTION, PRIVACY_ALERT, NO_USER_DETECTED, and ERROR states.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATE MACHINE OVERVIEW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *                        ┌─────────────────┐
 *                        │  INITIALIZING   │  ← Starting state on every reset()
 *                        └────────┬────────┘
 *                                 │  First evaluateFrame() call
 *                   ┌─────────────┼──────────────┐
 *                   ▼             ▼              ▼
 *           ┌──────────┐  ┌──────────────┐  ┌──────────────────┐
 *           │   SAFE   │  │   CAUTION    │  │  NO_USER_DETECTED │
 *           └──────────┘  └──────────────┘  └──────────────────┘
 *                │                │
 *                │   suspicious   │  After FRAME_CONFIRMATION_COUNT (4) consecutive
 *                │   frames       │  frames of unauthorized viewer looking at screen
 *                └────────────────┼──────────────────────────────────────────────▶
 *                                 ▼
 *                        ┌──────────────────┐
 *                        │  PRIVACY_ALERT   │  ← Blur shield activated
 *                        └────────┬─────────┘
 *                                 │
 *                                 │  When ONLY the enrolled authorized user is in view
 *                                 │  AND RECOVERY_DELAY_MS (2400 ms) has elapsed
 *                                 ▼
 *                              SAFE again
 *
 *   CAMERA_ERROR, MODEL_ERROR: entered immediately from any state when hardware/software fails.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GOLDEN SECURITY RULE (Fail-Secure)
 * ─────────────────────────────────────────────────────────────────────────────
 * A system failure, missing camera stream, or model crash must NEVER be silently
 * classified as SAFE. Any exception immediately transitions the engine into an
 * explicit ERROR state (CAMERA_ERROR or MODEL_ERROR).
 *
 * Rationale: If a camera is unplugged and the system silently stayed "SAFE",
 * an unauthorized viewer could unplug the camera to bypass protection. The system
 * must ALWAYS fail in a way that the user knows monitoring has been compromised.
 */

import { CONFIG } from './config.js'; // Central config (thresholds, timeouts, state name constants)

export class SecurityDecisionEngine {
  constructor() {
    // -------------------------------------------------------------------------
    // State machine fields
    // -------------------------------------------------------------------------

    // The engine starts in INITIALIZING — a neutral state that is neither
    // SAFE nor ALERT. This prevents the UI from flashing SAFE momentarily
    // before the first frame is analyzed.
    this.currentState = CONFIG.SECURITY.STATES.INITIALIZING;

    // Keeping a reference to the previous state lets evaluateFrame() detect
    // when a state transition occurs (stateChanged = true in the report).
    this.previousState = CONFIG.SECURITY.STATES.INITIALIZING;

    // -------------------------------------------------------------------------
    // Temporal confirmation buffers (anti-flicker counters)
    // -------------------------------------------------------------------------

    // WHY 4 CONSECUTIVE FRAMES before triggering PRIVACY_ALERT?
    // AI detectors are noisy. A single bad frame can momentarily mis-classify
    // the authorized user as "unauthorized", or temporarily drop eye-contact
    // detection due to a blink, blur, or lighting change. Without a confirmation
    // window, any brief glitch would instantly trigger an alert and blur the screen.
    //
    // Requiring CONFIG.SECURITY.FRAME_CONFIRMATION_COUNT (default: 4) consecutive
    // suspicious frames means a threat must persist for at least:
    //   4 × INFERENCE_INTERVAL_MS (110 ms) ≈ 440 ms
    // before an alert fires. This eliminates virtually all false positives from
    // single-frame detection noise while keeping the response time under half a second.
    this.consecutiveSuspiciousFrames = 0;

    // Counts consecutive safe frames — currently tracked for auditing purposes
    // and future use (e.g. requiring N safe frames to unlock from CAUTION faster).
    this.consecutiveSafeFrames = 0;

    // Tracks the last wall-clock time a face was detected.
    // Used to decide when to transition to NO_USER_DETECTED: if no face has been
    // seen for NO_USER_TIMEOUT_MS (2800 ms), the user has probably stepped away.
    this.lastFaceDetectedTime = Date.now();

    // Timestamp set when recovery from PRIVACY_ALERT begins (i.e. when the
    // threat clears and only the authorized user is visible). Used to enforce
    // the RECOVERY_DELAY_MS cooldown before unblurring.
    this.safeRecoveryStartTime = null;

    // -------------------------------------------------------------------------
    // Statistics and audit metrics
    // -------------------------------------------------------------------------
    // These counters accumulate across the entire monitoring session and can be
    // retrieved via getMetrics() for display on a dashboard or export to a log.
    this.metrics = {
      totalEvaluations: 0,     // Total number of frames processed
      privacyAlertCount: 0,    // Total number of times PRIVACY_ALERT was triggered
      cautionCount: 0,         // Total number of CAUTION state entries
      safeCount: 0,            // Total number of SAFE state entries
      lastThreatReason: ''     // Human-readable reason for the most recent threat
    };
  }

  /**
   * Evaluates the current scene analysis and determines the security state.
   *
   * This is called once per throttled inference frame (≈ every 110 ms by default).
   * It runs through a priority-ordered set of conditions and returns a security
   * report object. The order of evaluation matters: hardware errors take top priority,
   * then enrollment checks, then face analysis.
   *
   * EVALUATION ORDER (highest priority first):
   *   1. Camera error    → CAMERA_ERROR (fail-secure: never silently SAFE)
   *   2. Model not ready → MODEL_ERROR  (fail-secure)
   *   3. No face seen    → NO_USER_DETECTED (after timeout) or hold current state briefly
   *   4. No enrolled ID  → CAUTION (can't verify anyone)
   *   5. Face analysis   → SAFE / CAUTION / PRIVACY_ALERT based on identity + gaze
   *
   * @param {{
   *   faces: Array<{
   *     box: { x: number, y: number, width: number, height: number },
   *     score: number,
   *     matchResult: { isMatch: boolean, matchStatus: string, distance: number, confidencePercent: number },
   *     gazeResult: { gazeState: string, isLookingAtScreen: boolean, confidence: number, yawDeg: number, pitchDeg: number }
   *   }>,
   *   hasEnrolledUser: boolean,
   *   isCameraActive: boolean,
   *   isModelLoaded: boolean
   * }} sceneData - Full scene description assembled by app.js processVideoFrame()
   *
   * @returns {{
   *   state: string,
   *   previousState: string,
   *   stateChanged: boolean,
   *   reason: string,
   *   faceCount: number,
   *   threatLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'CRITICAL',
   *   shouldShieldBlur: boolean,
   *   suspiciousFrameCount: number,
   *   recoveryTimeRemainingMs: number
   * }} Security report consumed by app.js updateSecurityStateUI()
   */
  evaluateFrame(sceneData) {
    // Count every evaluation for auditing — including error states.
    this.metrics.totalEvaluations++;
    const now = Date.now(); // Current wall-clock time in ms (used for timeout comparisons)

    // =========================================================================
    // CHECK 1: Hardware / Model Invariant Checks (Fail-Secure)
    // =========================================================================
    // These checks run FIRST because a hardware or software failure must NEVER
    // be silently interpreted as a SAFE condition (the Golden Security Rule).
    //
    // If the camera stream is not active, we cannot see anything. An attacker
    // could exploit a non-fail-secure system by physically disconnecting the camera
    // to prevent their presence from being detected.
    if (!sceneData.isCameraActive) {
      return this.transitionTo(CONFIG.SECURITY.STATES.CAMERA_ERROR, 'Camera is disconnected or inactive.', 'CRITICAL');
    }

    // If the AI model hasn't loaded, we cannot analyze any frames.
    // Staying in SAFE while blind would be a serious security hole.
    if (!sceneData.isModelLoaded) {
      return this.transitionTo(CONFIG.SECURITY.STATES.MODEL_ERROR, 'AI computer vision models are not loaded.', 'CRITICAL');
    }

    const faces = sceneData.faces || []; // Array of analyzed face objects (may be empty)
    const faceCount = faces.length;      // How many faces were detected this frame

    // =========================================================================
    // CHECK 2: No Face Detected
    // =========================================================================
    // A completely empty frame could mean:
    //   a) The user briefly looked away, blinked, or moved quickly (transient dropout)
    //   b) The user genuinely left the desk (sustained absence)
    //
    // We distinguish these using NO_USER_TIMEOUT_MS: if no face has been seen for
    // longer than the timeout, we transition to NO_USER_DETECTED. Otherwise we hold
    // the current state to avoid flapping between SAFE and NO_USER_DETECTED on
    // a blink or brief head turn.
    if (faceCount === 0) {
      const timeSinceFace = now - this.lastFaceDetectedTime; // ms since the last face was seen

      if (timeSinceFace > CONFIG.SECURITY.NO_USER_TIMEOUT_MS) {
        // Sustained absence: user has not been visible for the full timeout window.
        // Reset confirmation buffers since the scene has fundamentally changed.
        this.consecutiveSuspiciousFrames = 0;
        this.safeRecoveryStartTime = null;
        return this.transitionTo(
          CONFIG.SECURITY.STATES.NO_USER_DETECTED,
          'No human face detected in camera viewport for configured timeout.',
          'LOW'
        );
      } else {
        // Brief detection dropout (e.g. blink or momentary motion blur).
        // Maintain the current state so the UI doesn't flash unnecessarily.
        // stateChanged = false tells app.js not to log a redundant audit event.
        return this.buildReport(this.currentState, 'Brief face detection dropout, holding state...', false);
      }
    }

    // A face is visible this frame — update the "last seen" timestamp.
    // This resets the NO_USER_TIMEOUT_MS countdown whenever any face is present.
    this.lastFaceDetectedTime = now;

    // =========================================================================
    // CHECK 3: No Enrolled Authorized Identity in Storage
    // =========================================================================
    // Without a biometric template, the system has no basis for identity
    // verification. We cannot say the person in front of the camera is authorized.
    // We enter CAUTION (not PRIVACY_ALERT) because we cannot confirm a *threat*
    // either — the person might be the rightful user who hasn't enrolled yet.
    if (!sceneData.hasEnrolledUser) {
      this.consecutiveSuspiciousFrames = 0; // No threat confirmation needed in this state
      this.safeRecoveryStartTime = null;
      return this.transitionTo(
        CONFIG.SECURITY.STATES.CAUTION,
        'No authorized user enrolled yet. System cannot verify identity.',
        'MEDIUM'
      );
    }

    // =========================================================================
    // CHECK 4: Analyze Detected Faces
    // =========================================================================
    // Categorize each detected face into one of four buckets based on identity
    // match result and gaze direction. These counts drive the threat rules below.
    let authorizedFaceCount = 0;         // Faces verified as the enrolled authorized user
    let unauthorizedFacingScreenCount = 0; // Unknown/unauthorized faces looking AT the screen (highest threat)
    let unauthorizedLookingAwayCount = 0;  // Unknown/unauthorized faces looking AWAY (lower threat)
    let uncertainFacesCount = 0;          // Faces with borderline recognition confidence (UNCERTAIN match)
    let threatReason = '';                // Human-readable description of the most significant threat found

    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      const match = f.matchResult; // { matchStatus: 'AUTHORIZED'|'UNCERTAIN'|'UNKNOWN', distance, ... }
      const gaze = f.gazeResult;   // { gazeState: 'LOOKING_AT_SCREEN'|'LOOKING_AWAY'|..., isLookingAtScreen, ... }

      if (match.matchStatus === 'AUTHORIZED') {
        // This face matches the enrolled template within the AUTHORIZED threshold
        // (Euclidean distance < CONFIG.RECOGNITION.MATCH_THRESHOLD, default 0.52).
        authorizedFaceCount++;

      } else if (match.matchStatus === 'UNCERTAIN') {
        // Distance falls in the UNCERTAIN band (0.52 – 0.64): may or may not be the user.
        // We treat this conservatively as a potential issue, not a confirmed threat.
        uncertainFacesCount++;
        threatReason = `Detected face with borderline recognition confidence (Distance: ${match.distance}).`;

      } else {
        // UNKNOWN: Euclidean distance > 0.64 — clearly not the enrolled user.
        // The specific threat level depends on where this person is LOOKING.
        if (gaze.gazeState === CONFIG.GAZE.STATES.LOOKING_AT_SCREEN) {
          // The unauthorized person is actively oriented toward the screen.
          // This is a confirmed shoulder-surfing or eavesdropping attempt.
          unauthorizedFacingScreenCount++;
          threatReason = `Unauthorized person detected looking directly toward screen (Face #${i + 1}).`;
        } else if (gaze.gazeState === CONFIG.GAZE.STATES.LOOKING_AWAY) {
          // The unauthorized person is nearby but not currently looking at the screen.
          // This is a lower-threat situation — they may just be in the room.
          unauthorizedLookingAwayCount++;
          threatReason = `Unauthorized person detected nearby but currently oriented away (Face #${i + 1}).`;
        } else {
          // Gaze state is ambiguous (e.g. detection confidence too low to classify reliably).
          uncertainFacesCount++;
          threatReason = `Unauthorized person detected with uncertain gaze/orientation (Face #${i + 1}).`;
        }
      }
    }

    // =========================================================================
    // CHECK 5: Threat Classification Rules (priority ordered)
    // =========================================================================

    // -------------------------------------------------------------------------
    // CONDITION A: Potential Privacy Breach
    // An unauthorized face is confirmed to be looking at the screen.
    // This is the highest-threat scenario — a person is actively reading private content.
    //
    // WHY REQUIRE 4 CONSECUTIVE FRAMES?
    // A single frame mis-classification (a blink registering as "unknown", or a brief
    // reflection off glasses) would trigger a jarring alert with no real threat.
    // Requiring 4 consecutive suspicious frames (≈440 ms at 110 ms inference interval)
    // ensures only sustained, genuine threats trigger the alarm, while transient
    // detection glitches resolve themselves before the threshold is reached.
    // -------------------------------------------------------------------------
    if (unauthorizedFacingScreenCount > 0) {
      this.consecutiveSuspiciousFrames++; // Increment the confirmation counter for this frame

      // Reset recovery timer: a new suspicious frame means we are not recovering yet.
      this.safeRecoveryStartTime = null;

      // Check whether the confirmation threshold has been reached.
      if (this.consecutiveSuspiciousFrames >= CONFIG.SECURITY.FRAME_CONFIRMATION_COUNT) {
        // Confirmed privacy threat — the unauthorized viewer has been looking at the
        // screen for FRAME_CONFIRMATION_COUNT (4) consecutive analysis frames.
        this.metrics.privacyAlertCount++;
        this.metrics.lastThreatReason = threatReason;
        return this.transitionTo(
          CONFIG.SECURITY.STATES.PRIVACY_ALERT,
          `${threatReason} Confirmed across ${this.consecutiveSuspiciousFrames} consecutive frames.`,
          'CRITICAL' // Highest threat level — activates the CSS blur shield
        );
      } else {
        // Suspicious condition accumulating but not yet confirmed.
        // Transition to CAUTION to give the user a visual warning that something is happening.
        // The count is shown in the reason so the user can see the confirmation building up.
        return this.transitionTo(
          CONFIG.SECURITY.STATES.CAUTION,
          `Suspicious viewer detected (${this.consecutiveSuspiciousFrames}/${CONFIG.SECURITY.FRAME_CONFIRMATION_COUNT} confirmation frames)...`,
          'MEDIUM'
        );
      }
    }

    // -------------------------------------------------------------------------
    // CONDITION B: Caution Scenarios (non-critical but worth flagging)
    // Any of these situations warrants a yellow CAUTION state:
    //   - An UNCERTAIN face (might be the user, might not be)
    //   - An unauthorized person who is currently looking away (present but not reading screen)
    //   - Multiple faces including the authorized user (shoulder surfer present)
    //
    // WHY CAUTION AND NOT ALERT for "looking away"?
    // If an unauthorized person has their back to the screen, they are not currently
    // reading sensitive content. We alert the user to their presence but do NOT
    // blur the screen, which would unnecessarily interrupt the authorized user's work.
    // -------------------------------------------------------------------------
    if (uncertainFacesCount > 0 || unauthorizedLookingAwayCount > 0 || (faceCount > 1 && authorizedFaceCount > 0)) {
      this.consecutiveSuspiciousFrames = 0; // The facing-screen counter is not relevant here
      this.safeRecoveryStartTime = null;
      this.metrics.cautionCount++;
      return this.transitionTo(
        CONFIG.SECURITY.STATES.CAUTION,
        threatReason || 'Multiple faces present or gaze uncertainty detected.',
        'MEDIUM'
      );
    }

    // -------------------------------------------------------------------------
    // CONDITION C: Candidate Safe State
    // Exactly 1 face detected AND that face is the enrolled authorized user.
    // This is the ideal steady-state for a single-user system.
    //
    // RECOVERY COOLDOWN — WHY WAIT 2.4s BEFORE UNBLURRING?
    // When a threat clears (the intruder leaves), we don't want to immediately
    // remove the privacy blur. The intruder could "flash" in and out of frame
    // rapidly (e.g. peek-a-boo attack) causing the shield to flicker on and off.
    // A 2.4-second sustained recovery window ensures the threat has genuinely
    // resolved before the user's screen is revealed again.
    //
    // HOW IT WORKS:
    //   1. When we first see authorized-only after PRIVACY_ALERT, we record
    //      safeRecoveryStartTime = now.
    //   2. On subsequent frames, we check how long we've been in the safe state.
    //   3. We stay in PRIVACY_ALERT with the shield active until
    //      (now - safeRecoveryStartTime) >= RECOVERY_DELAY_MS.
    //   4. Only after the full cooldown elapses do we transition to SAFE and
    //      remove the blur.
    // -------------------------------------------------------------------------
    if (faceCount === 1 && authorizedFaceCount === 1) {
      this.consecutiveSuspiciousFrames = 0; // No suspicious frames in this scenario

      // Check if we are recovering from a previous PRIVACY_ALERT.
      // The cooldown only applies when transitioning OUT of PRIVACY_ALERT.
      if (this.currentState === CONFIG.SECURITY.STATES.PRIVACY_ALERT) {
        if (!this.safeRecoveryStartTime) {
          // First safe frame after the alert — start the recovery countdown.
          this.safeRecoveryStartTime = now;
        }

        const elapsedSafeMs = now - this.safeRecoveryStartTime; // How long we've been safe
        const remainingMs = Math.max(0, CONFIG.SECURITY.RECOVERY_DELAY_MS - elapsedSafeMs); // Time left in cooldown

        if (remainingMs > 0) {
          // Still within the cooldown window — keep the blur shield active.
          // We stay in PRIVACY_ALERT state internally (shouldShieldBlur = true)
          // but update the reason text to show the countdown so the user knows
          // the system is recovering rather than stuck.
          return this.buildReport(
            CONFIG.SECURITY.STATES.PRIVACY_ALERT,
            `Threat cleared. Verifying sustained safety for ${(remainingMs / 1000).toFixed(1)}s before unblurring...`,
            true,       // shouldShieldBlur = true: keep the blur active during cooldown
            remainingMs // recoveryTimeRemainingMs: shown in the UI for transparency
          );
        }
        // Cooldown complete — fall through to the SAFE transition below.
      }

      // All safe conditions verified AND cooldown satisfied (or we weren't in PRIVACY_ALERT).
      // Clear the recovery timer and transition to fully SAFE.
      this.safeRecoveryStartTime = null;
      this.metrics.safeCount++;
      return this.transitionTo(
        CONFIG.SECURITY.STATES.SAFE,
        'Authorized user active and alone. No unauthorized screen viewers detected.',
        'NONE' // No threat — lowest threat level
      );
    }

    // =========================================================================
    // FALLBACK: Unclassified scene (1 unknown face, not looking at screen)
    // =========================================================================
    // This should rarely be reached: it fires when faceCount === 1 but the
    // face is not authorized AND conditions A and B did not match (e.g. gaze
    // state was neither LOOKING_AT_SCREEN nor LOOKING_AWAY). Treat conservatively.
    this.consecutiveSuspiciousFrames = 0;
    this.safeRecoveryStartTime = null;
    return this.transitionTo(
      CONFIG.SECURITY.STATES.CAUTION,
      'Unrecognized person detected in view.',
      'MEDIUM'
    );
  }

  /**
   * Handles state transitions with audit reporting.
   *
   * Updates currentState and previousState, then delegates to buildReport()
   * to construct the uniform report object. Separation of concerns: this method
   * owns the state mutation; buildReport() owns the report structure.
   *
   * @param {string} newState   - The target state (from CONFIG.SECURITY.STATES)
   * @param {string} reason     - Human-readable explanation for the transition
   * @param {string} threatLevel - 'NONE' | 'LOW' | 'MEDIUM' | 'CRITICAL'
   * @returns {Object} Security report
   */
  transitionTo(newState, reason, threatLevel) {
    // Determine whether this call actually changes the state.
    // stateChanged = true triggers an audit log entry in app.js.
    const stateChanged = this.currentState !== newState;

    // Archive the current state before overwriting it (used in buildReport).
    this.previousState = this.currentState;

    // Apply the new state.
    this.currentState = newState;

    // The blur shield is only active during PRIVACY_ALERT (the report
    // returned by buildReport will carry this as shouldShieldBlur = true).
    const shouldShieldBlur = newState === CONFIG.SECURITY.STATES.PRIVACY_ALERT;

    return this.buildReport(newState, reason, shouldShieldBlur, 0, stateChanged, threatLevel);
  }

  /**
   * Helper to construct uniform security report object.
   *
   * Every code path that returns from evaluateFrame() calls either transitionTo()
   * or buildReport() directly. Having a single report builder ensures the report
   * schema is always consistent — no missing fields, no typos in field names.
   *
   * @param {string}  state                  - Current security state string
   * @param {string}  reason                 - Reason for this state
   * @param {boolean} shouldShieldBlur       - Whether the CSS blur shield should be active
   * @param {number}  [recoveryTimeRemainingMs=0] - Milliseconds remaining in the recovery cooldown
   * @param {boolean} [stateChanged=false]   - Whether the state changed from the previous frame
   * @param {string}  [threatLevel='NONE']   - Threat severity level
   * @returns {Object} Fully-formed security report consumed by app.js
   */
  buildReport(state, reason, shouldShieldBlur, recoveryTimeRemainingMs = 0, stateChanged = false, threatLevel = 'NONE') {
    return {
      state,                                            // e.g. 'SAFE', 'PRIVACY_ALERT'
      previousState: this.previousState,                // State before the most recent transition
      stateChanged,                                     // True if state changed this frame (triggers audit log)
      reason,                                           // Human-readable explanation string
      threatLevel,                                      // 'NONE' | 'LOW' | 'MEDIUM' | 'CRITICAL'
      shouldShieldBlur,                                 // True → app.js activates the CSS blur shield
      suspiciousFrameCount: this.consecutiveSuspiciousFrames, // Current confirmation frame count
      recoveryTimeRemainingMs                           // ms until blur is lifted (0 if not recovering)
    };
  }

  /**
   * Reset engine internal counters (used on monitoring start/stop).
   *
   * Called by app.js whenever the user starts or stops monitoring.
   * Wiping all counters ensures the state machine is in a clean slate for
   * the new session and doesn't carry over confirmation windows or cooldowns
   * from a previous monitoring session.
   */
  reset() {
    // Return to the neutral starting state — not SAFE (which would imply a verified condition)
    // and not any alert state (which would immediately blur the screen before analysis).
    this.currentState = CONFIG.SECURITY.STATES.INITIALIZING;
    this.previousState = CONFIG.SECURITY.STATES.INITIALIZING;

    // Clear both temporal confirmation counters so the first frames of a new
    // session don't inherit suspicious-frame counts from the last session.
    this.consecutiveSuspiciousFrames = 0;
    this.consecutiveSafeFrames = 0;

    // Clear the recovery cooldown timer (irrelevant at the start of a new session).
    this.safeRecoveryStartTime = null;

    // Reset the face presence timestamp to now so the NO_USER_TIMEOUT_MS countdown
    // starts fresh — the user presumably just sat down when they click Start.
    this.lastFaceDetectedTime = Date.now();

    // Note: metrics are intentionally NOT reset here so they accumulate across
    // start/stop cycles within the same page load (useful for session summaries).
  }

  /**
   * Returns engine metrics.
   *
   * Returns a shallow copy (spread operator) so callers cannot mutate the
   * internal metrics object from outside the class.
   *
   * @returns {{ totalEvaluations: number, privacyAlertCount: number, cautionCount: number, safeCount: number, lastThreatReason: string }}
   */
  getMetrics() {
    return { ...this.metrics }; // Spread creates a plain object copy — mutation-safe
  }
}
