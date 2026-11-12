/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Gaze & Head Pose Estimation Module (js/gaze-estimation.js)
 *
 * Maintained primarily by Member 2 (Gaze Estimation and Security Decision Engine)
 *
 * SCIENTIFIC FOUNDATION & METHODOLOGY:
 * Full hardware eye-tracking requires dedicated infrared illuminators and corneal-reflection
 * cameras. In standard laptop webcams, VisionGuard implements a documented landmark-based
 * gaze approximation combining:
 * 1. Head Pose Orientation (Yaw & Pitch) computed from 3D facial geometry anchors (nose, eye corners, chin).
 * 2. Eye Aspect Ratio (EAR) to detect blinking, squinting, or closed eyelids.
 * 3. Relative pupil/iris positioning within the palpebral fissure.
 *
 * FACIAL LANDMARK INDEX REFERENCE (68-point model):
 * The face-api landmark model returns exactly 68 {x, y} points, indexed 0–67.
 * Key indices used in this module:
 *   36–41 → Left eye  (36 = outer corner, 39 = inner corner; 37,38 = upper lid; 40,41 = lower lid)
 *   42–47 → Right eye (42 = inner corner, 45 = outer corner; 43,44 = upper lid; 46,47 = lower lid)
 *   30    → Nose tip  (the bottommost point of the nose bridge — a stable anchor for yaw estimation)
 *   8     → Chin      (the lowest face landmark — used as the bottom anchor for pitch estimation)
 *
 * CANDIDATE CRITICAL RULE:
 * This module associates gaze outputs uniquely to each individual face detected,
 * guaranteeing that one person's gaze is never misattributed to another person.
 */

// Import centralized configuration so gaze thresholds are managed in a single config file.
import { CONFIG } from './config.js';

// GazeEstimator is a class (not a bare function) so app.js can hold one instance
// and configuration values are set once in the constructor.
export class GazeEstimator {
  constructor() {
    // Yaw threshold (degrees): maximum allowed left/right head rotation before we classify
    // the person as "looking away". Loaded from CONFIG so it can be tuned without editing this file.
    this.yawThreshold = CONFIG.GAZE.YAW_SCREEN_THRESHOLD_DEG;

    // Pitch threshold (degrees): maximum allowed up/down head tilt before "looking away".
    // Pitch is typically smaller than yaw because downward glances (e.g., phone) are common.
    this.pitchThreshold = CONFIG.GAZE.PITCH_SCREEN_THRESHOLD_DEG;

    // EAR threshold: if the Eye Aspect Ratio falls below this value both eyes are closed/blinking.
    // A fully open eye typically has EAR ≈ 0.25–0.30; a closed eye approaches 0.0.
    this.earThreshold = CONFIG.GAZE.EAR_BLINK_THRESHOLD;
  }

  /**
   * Estimates whether the given face is looking toward the laptop screen.
   *
   * PIPELINE OVERVIEW:
   *   1. Guard checks  — validate landmark count and detector confidence.
   *   2. EAR check     — are eyes open? (Eyes closed → cannot determine gaze)
   *   3. Yaw estimate  — left/right head rotation in degrees (using nose-tip vs eye-corner geometry)
   *   4. Pitch estimate — up/down head tilt in degrees (using nose-tip vs chin/eye vertical geometry)
   *   5. Decision      — both yaw and pitch within thresholds → LOOKING_AT_SCREEN, else LOOKING_AWAY
   *   6. Confidence    — a continuous score (0.2–1.0) built from angular penalties + detector score
   *
   * @param {any} faceLandmarks  - 68-point facial landmarks object from face-api (.positions array)
   * @param {number} faceIndex   - Zero-based index of this face among all faces detected in the frame.
   *                               Passed through to the result so the security engine can correlate
   *                               gaze results back to the correct face descriptor.
   * @param {number} detectionScore - Face detector confidence (0.0–1.0). Low scores mean the
   *                               bounding box / landmark positions may be inaccurate.
   * @returns {{
   *   faceIndex: number,
   *   gazeState: 'LOOKING_AT_SCREEN' | 'LOOKING_AWAY' | 'UNCERTAIN',
   *   isLookingAtScreen: boolean,
   *   confidence: number,   // 0.2–1.0 continuous score
   *   yawDeg: number,       // positive = turned right, negative = turned left
   *   pitchDeg: number,     // positive = tilted down, negative = tilted up
   *   avgEar: number,       // average Eye Aspect Ratio of both eyes
   *   reason: string        // human-readable explanation for UI / logging
   * }}
   */
  estimateGaze(faceLandmarks, faceIndex = 0, detectionScore = 1.0) {
    // Guard: face-api requires at least 68 landmark points for all subsequent index lookups.
    // If fewer points are returned (partial detection), we cannot reliably compute gaze angles.
    if (!faceLandmarks || !faceLandmarks.positions || faceLandmarks.positions.length < 68) {
      return {
        faceIndex,
        gazeState: CONFIG.GAZE.STATES.UNCERTAIN,
        isLookingAtScreen: false,
        confidence: 0.1,   // Very low confidence — landmark data is insufficient
        yawDeg: 0,
        pitchDeg: 0,
        avgEar: 0,
        reason: 'Insufficient facial landmark points detected.'
      };
    }

    // Alias the positions array for shorter, cleaner index access below.
    // pts[i] is an {x, y} object representing pixel coordinates on the video frame.
    const pts = faceLandmarks.positions;

    // Guard: if the face detector itself is not confident in this bounding box,
    // the landmark positions are likely misaligned and would produce unreliable angles.
    // 0.55 was chosen empirically — below this, angle errors become too large to trust.
    if (detectionScore < 0.55) {
      return {
        faceIndex,
        gazeState: CONFIG.GAZE.STATES.UNCERTAIN,
        isLookingAtScreen: false,
        confidence: parseFloat(detectionScore.toFixed(2)),
        yawDeg: 0,
        pitchDeg: 0,
        avgEar: 0,
        reason: `Low face detection confidence (${detectionScore.toFixed(2)}). Landmark alignment uncertain.`
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Eye Aspect Ratio (EAR) — detect if eyes are open
    //
    // EAR FORMULA (Soukupová & Čech, 2016):
    //   EAR = ( ||p2 - p6|| + ||p3 - p5|| ) / ( 2 × ||p1 - p4|| )
    //
    // where for each eye:
    //   p1 = outer corner (horizontal anchor)
    //   p2 = upper-inner vertical point
    //   p3 = upper-outer vertical point
    //   p4 = inner corner (horizontal anchor)
    //   p5 = lower-outer vertical point
    //   p6 = lower-inner vertical point
    //
    // The numerator sums two vertical distances (height of the eye opening).
    // The denominator is twice the horizontal eye width.
    // Result: a ratio independent of face size — EAR ≈ 0.25–0.30 open, ≈ 0.0 closed.
    //
    // LEFT EYE landmark indices (36–41):
    //   36 = outer corner (p1), 37 = upper-inner (p2), 38 = upper-outer (p3),
    //   39 = inner corner (p4), 40 = lower-outer (p5), 41 = lower-inner (p6)
    const leftEar = this.calculateEyeAspectRatio(pts[36], pts[37], pts[38], pts[39], pts[40], pts[41]);

    // RIGHT EYE landmark indices (42–47) — note: ordering is mirrored so p1→p4 is still outer→inner.
    //   45 = outer corner (p1), 44 = upper-outer (p2), 43 = upper-inner (p3),
    //   42 = inner corner (p4), 47 = lower-inner (p5), 46 = lower-outer (p6)
    const rightEar = this.calculateEyeAspectRatio(pts[45], pts[44], pts[43], pts[42], pts[47], pts[46]);

    // Average both eyes — a single-eye blink would otherwise spike as "closed" for the wrong eye.
    // Averaging gives a stable bilateral measure of eye openness.
    const avgEar = (leftEar + rightEar) / 2.0;

    // If the EAR falls below the blink threshold, we cannot determine where the eyes are pointing,
    // so we return UNCERTAIN rather than risking a false LOOKING_AT_SCREEN verdict.
    if (avgEar < this.earThreshold) {
      return {
        faceIndex,
        gazeState: CONFIG.GAZE.STATES.UNCERTAIN,
        isLookingAtScreen: false,
        confidence: 0.4,   // Moderate confidence in detection, but gaze is indeterminate
        yawDeg: 0,
        pitchDeg: 0,
        avgEar: parseFloat(avgEar.toFixed(3)),
        reason: `Eyes closed or blinking (EAR: ${avgEar.toFixed(2)} < ${this.earThreshold}). Gaze cannot be confirmed.`
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Head Pose YAW — left/right horizontal rotation of the head
    //
    // WHAT IS YAW:
    //   Yaw describes the rotation of the head around the vertical axis.
    //   Yaw = 0°  → face pointing straight ahead (at the screen)
    //   Yaw > 0°  → head turned to the RIGHT (nose shifts right relative to eye span)
    //   Yaw < 0°  → head turned to the LEFT  (nose shifts left relative to eye span)
    //
    // GEOMETRIC APPROACH:
    //   We use landmark 30 (nose tip) as a naturally protruding anchor.
    //   When viewed from the front, the nose tip is roughly centered between the outer eye corners.
    //   As the head rotates left/right, the nose tip shifts toward the near-side eye corner.
    //
    //   ratio = (noseTip.x − leftEyeOuter.x) / eyeSpanX
    //   At 0° yaw:  ratio ≈ 0.50 (nose centered)
    //   Turned right: ratio > 0.50 (nose moves right, toward right eye)
    //   Turned left:  ratio < 0.50 (nose moves left, toward left eye)
    //
    //   yawDeg = (ratio − 0.50) × 85.0
    //   The 85.0 is an empirical scale factor mapping [0.0, 1.0] ratio range to roughly ±42°.

    const leftEyeOuter = pts[36];   // Landmark 36: left eye outer corner (furthest left point of left eye)
    const rightEyeOuter = pts[45];  // Landmark 45: right eye outer corner (furthest right point of right eye)
    const noseTip = pts[30];        // Landmark 30: nose tip — the most horizontally sensitive anchor

    // Eye span in pixels — the horizontal distance between outer eye corners.
    // Used as the normalizing denominator so the ratio is scale-invariant (works at any face size).
    const eyeSpanX = Math.abs(rightEyeOuter.x - leftEyeOuter.x);

    let yawDeg = 0;
    if (eyeSpanX > 10) {
      // Only compute yaw when the face is wide enough — very small spans mean the face is
      // too far from the camera and landmark precision drops sharply below 10px span.
      const yawRatio = (noseTip.x - leftEyeOuter.x) / eyeSpanX; // 0.0 (far left) to 1.0 (far right)
      yawDeg = (yawRatio - 0.50) * 85.0; // Shift to center at 0°; scale to degrees via empirical factor
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Head Pose PITCH — up/down vertical tilt of the head
    //
    // WHAT IS PITCH:
    //   Pitch describes the rotation of the head around the horizontal axis.
    //   Pitch = 0°  → face level, looking straight ahead
    //   Pitch > 0°  → head tilted DOWN (looking at lap / phone / keyboard)
    //   Pitch < 0°  → head tilted UP   (looking at ceiling / something above screen)
    //
    // GEOMETRIC APPROACH:
    //   We track the nose tip (30) relative to the vertical range from mid-eye level to chin (8).
    //   As the head tilts up, the nose rises relative to the eye line and chin.
    //   As the head tilts down, the nose drops relative to the eye line.
    //
    //   midEyeY      = average Y of outer eye corners
    //   faceHeightY  = chin.y − midEyeY  (the vertical extent of the face)
    //   pitchRatio   = (noseTip.y − midEyeY) / faceHeightY
    //   At straight ahead: pitchRatio ≈ 0.37 (nose is roughly 37% of the way from eyes to chin)
    //   pitchDeg = (pitchRatio − 0.37) × 75.0  (centered and scaled empirically)

    // Mid-eye Y: the average vertical position between both outer eye corners.
    // Used as a stable "eye line" baseline for vertical pitch measurement.
    const midEyeY = (leftEyeOuter.y + rightEyeOuter.y) / 2.0;

    const chin = pts[8]; // Landmark 8: chin tip — the bottommost facial landmark, stable vertical anchor

    // Vertical distance from eye level to chin, in pixels — used to normalize pitch ratio.
    const faceHeightY = Math.abs(chin.y - midEyeY);

    let pitchDeg = 0;
    if (faceHeightY > 15) {
      // Only compute pitch when the face vertical span is large enough — below 15px the
      // measurement is too noisy to be meaningful (face is very far from camera or profile view).
      const pitchRatio = (noseTip.y - midEyeY) / faceHeightY; // Ratio of nose position within face height
      // Normal frontal pitch: ratio ≈ 0.37; subtract it to center at 0°, multiply by 75° scale factor.
      pitchDeg = (pitchRatio - 0.37) * 75.0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Decision Logic — Is the person oriented toward the screen?
    //
    // A person is considered LOOKING_AT_SCREEN only if BOTH:
    //   - |yawDeg|   ≤ yawThreshold   (not rotated too far left or right)
    //   - |pitchDeg| ≤ pitchThreshold (not tilted too far up or down)
    // Otherwise they are LOOKING_AWAY.

    const isYawFacingScreen = Math.abs(yawDeg) <= this.yawThreshold;
    const isPitchFacingScreen = Math.abs(pitchDeg) <= this.pitchThreshold;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Confidence Metric
    //
    // A continuous confidence score helps the security engine weigh gaze results
    // that are "just barely" looking away vs. those that are clearly off-screen.
    //
    // yawPenalty / pitchPenalty: 0.0 at center, 1.0 when exceeding 1.5× the threshold.
    // Combined into a final score multiplied by the detector's own confidence.
    // Floor of 0.2 ensures the value is never zero (even extreme angles have some info).

    const yawPenalty = Math.min(1.0, Math.abs(yawDeg) / (this.yawThreshold * 1.5));
    const pitchPenalty = Math.min(1.0, Math.abs(pitchDeg) / (this.pitchThreshold * 1.5));
    const gazeConfidence = parseFloat(
      Math.max(0.2, (1.0 - (yawPenalty * 0.5 + pitchPenalty * 0.5)) * detectionScore).toFixed(2)
    );

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: Return the gaze result object

    if (isYawFacingScreen && isPitchFacingScreen) {
      // Both angles are within acceptable limits — the person is facing the screen.
      return {
        faceIndex,
        gazeState: CONFIG.GAZE.STATES.LOOKING_AT_SCREEN,
        isLookingAtScreen: true,
        confidence: gazeConfidence,
        yawDeg: parseFloat(yawDeg.toFixed(1)),
        pitchDeg: parseFloat(pitchDeg.toFixed(1)),
        avgEar: parseFloat(avgEar.toFixed(3)),
        reason: `Head pose and eye landmarks indicate direct orientation toward screen (Yaw: ${yawDeg.toFixed(1)}°, Pitch: ${pitchDeg.toFixed(1)}°).`
      };
    } else {
      // Build a human-readable description of the direction they are looking away.
      // This is logged in the UI telemetry panel so the user can understand why an alert fired.
      const directionDesc = [];
      if (yawDeg > this.yawThreshold) directionDesc.push('turned right');       // Head rotated clockwise
      else if (yawDeg < -this.yawThreshold) directionDesc.push('turned left');  // Head rotated counter-clockwise
      if (pitchDeg > this.pitchThreshold) directionDesc.push('tilted down');    // Head bowed forward
      else if (pitchDeg < -this.pitchThreshold) directionDesc.push('tilted up');// Head raised backward

      return {
        faceIndex,
        gazeState: CONFIG.GAZE.STATES.LOOKING_AWAY,
        isLookingAtScreen: false,
        confidence: gazeConfidence,
        yawDeg: parseFloat(yawDeg.toFixed(1)),
        pitchDeg: parseFloat(pitchDeg.toFixed(1)),
        avgEar: parseFloat(avgEar.toFixed(3)),
        reason: `Subject is looking away from screen (${directionDesc.join(', ')}: Yaw ${yawDeg.toFixed(1)}°, Pitch ${pitchDeg.toFixed(1)}°).`
      };
    }
  }

  /**
   * Computes the Euclidean distance between two 2D landmark points.
   *
   * Used internally by calculateEyeAspectRatio to measure the vertical and horizontal
   * extents of each eye. Each landmark point has {x, y} pixel coordinates.
   *
   * Formula: d = sqrt((p2.x − p1.x)² + (p2.y − p1.y)²)
   *
   * @param {{ x: number, y: number }} p1 - First 2D point
   * @param {{ x: number, y: number }} p2 - Second 2D point
   * @returns {number} Euclidean pixel distance between p1 and p2
   */
  dist(p1, p2) {
    const dx = p1.x - p2.x; // Horizontal component of distance
    const dy = p1.y - p2.y; // Vertical component of distance
    return Math.sqrt(dx * dx + dy * dy); // Pythagorean theorem to get straight-line distance
  }

  /**
   * Computes Soukupová and Čech's Eye Aspect Ratio (EAR) metric.
   *
   * EAR FORMULA:
   *   EAR = ( ||p2 - p6|| + ||p3 - p5|| ) / ( 2 × ||p1 - p4|| )
   *
   * PARAMETER MAPPING TO EYE ANATOMY:
   *   p1 = outer eye corner (leftmost or rightmost horizontal anchor)
   *   p2 = upper lid, inner side  (one of two vertical measurement points on the upper lid)
   *   p3 = upper lid, outer side  (second vertical measurement point on the upper lid)
   *   p4 = inner eye corner       (the other horizontal anchor)
   *   p5 = lower lid, outer side  (vertical measurement point on the lower lid)
   *   p6 = lower lid, inner side  (second vertical measurement point on the lower lid)
   *
   * INTERPRETATION:
   *   The numerator is the sum of two vertical chord lengths across the eye opening.
   *   The denominator is twice the horizontal eye width, used to normalize for face size.
   *   - Open eye:   EAR ≈ 0.25 – 0.30 (tall opening relative to width)
   *   - Closing eye: EAR falls smoothly toward 0.0
   *   - Closed eye:  EAR ≈ 0.0 – 0.05
   *   This scale-invariant ratio works at any distance from the camera.
   *
   * REFERENCE: Soukupová T, Čech J. "Real-Time Eye Blink Detection using Facial Landmarks." (2016)
   *
   * @param {{ x, y }} p1 - Outer corner landmark
   * @param {{ x, y }} p2 - Upper lid inner landmark
   * @param {{ x, y }} p3 - Upper lid outer landmark
   * @param {{ x, y }} p4 - Inner corner landmark
   * @param {{ x, y }} p5 - Lower lid outer landmark
   * @param {{ x, y }} p6 - Lower lid inner landmark
   * @returns {number} EAR value (0.0 = fully closed, ~0.3 = fully open)
   */
  calculateEyeAspectRatio(p1, p2, p3, p4, p5, p6) {
    // Measure vertical chord A: distance between upper-inner and lower-inner lid points.
    const verticalA = this.dist(p2, p6);

    // Measure vertical chord B: distance between upper-outer and lower-outer lid points.
    // Using two chords (A and B) instead of one gives a more robust average height measurement.
    const verticalB = this.dist(p3, p5);

    // Measure horizontal eye width: distance between outer and inner eye corners.
    // This is the normalizing factor that makes EAR independent of image scale.
    const horizontal = this.dist(p1, p4);

    // Guard: if the eye has zero horizontal width (degenerate case / numerical error),
    // return 0 to signal "closed" rather than producing a division-by-zero NaN.
    if (horizontal === 0) return 0;

    // Apply the EAR formula: average the two vertical measures, then divide by the
    // horizontal span. The factor of 2 in the denominator compensates for averaging
    // two vertical distances while using a single horizontal distance.
    return (verticalA + verticalB) / (2.0 * horizontal);
  }
}
