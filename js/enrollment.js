/**
 * VisionGuard: AI-Powered Facial Access Control System
 * User Enrollment Module (js/enrollment.js)
 *
 * Maintained primarily by Member 1 (Face Detection and Facial Recognition)
 *
 * RESPONSIBILITY:
 * 1. Guides the user through authorized-identity enrollment.
 * 2. Captures multiple high-quality facial embedding samples.
 * 3. Averages and normalizes embedding samples into a robust master template vector.
 * 4. Stores ONLY the 128-d floating-point mathematical vector in browser localStorage.
 * 5. Provides deletion and reset functions.
 *
 * PRIVACY BY DESIGN — WHY NO IMAGES ARE STORED:
 * No raw camera photos, webcam recordings, or facial images are ever stored on disk
 * or transmitted over a network. Only the 128 mathematical numbers representing facial
 * geometry features are stored locally in the browser's origin-isolated storage.
 * This design means:
 *   - A data breach exposes 128 floats — useless without the original ResNet model.
 *   - No GDPR/biometric image consent is needed beyond the numeric embedding.
 *   - The user cannot be re-identified from the stored vector alone (one-way mapping).
 *
 * WHY 5 SAMPLES ARE AVERAGED (Noise Cancellation):
 * A single-frame embedding is susceptible to momentary noise — a slight head tilt,
 * motion blur, variable lighting, or webcam sensor fluctuation can shift the 128-d
 * vector by a small but measurable amount. Capturing 5 frames spread 350ms apart and
 * averaging their descriptors dimension-by-dimension cancels out these random per-frame
 * errors. The result is a stable "mean face" template that represents the user across
 * normal variation in real-world conditions.
 *
 * WHY L2-NORMALIZATION IS APPLIED:
 * After averaging, the magnitude (L2 norm) of the resulting vector may drift slightly
 * from 1.0 due to the averaging operation. The face recognition model was trained to
 * produce unit-norm descriptors (vectors of length 1.0 in 128-D space). Euclidean
 * distance comparisons are geometrically calibrated against that assumption: two
 * unit-norm vectors' Euclidean distance maps cleanly to their angular separation.
 * Re-normalizing the averaged template restores the unit norm so the MATCH_THRESHOLD
 * (0.52) and UNCERTAIN_THRESHOLD (0.64) remain geometrically valid.
 */

// Import centralized configuration for sample count, interval, min confidence, and storage key.
import { CONFIG } from './config.js';

// EnrollmentManager is a class that wraps a FaceRecognizer instance.
// It is responsible only for enrollment I/O — it does not contain any detection logic itself.
export class EnrollmentManager {
  /**
   * @param {FaceRecognizer} faceRecognizer - An already-constructed (and loaded) FaceRecognizer instance.
   *   The recognizer is injected (dependency injection) rather than created here so a single
   *   shared instance is used by both enrollment and runtime recognition, avoiding redundant model loads.
   */
  constructor(faceRecognizer) {
    // Store the shared recognizer reference — used in enrollFromVideo to extract descriptors.
    this.faceRecognizer = faceRecognizer;

    // The localStorage key under which the enrolled user profile JSON is stored.
    // Using CONFIG keeps the key consistent between writes here and reads in app.js.
    this.storageKey = CONFIG.RECOGNITION.STORAGE_KEY;
  }

  /**
   * Checks whether a valid enrolled user profile already exists in localStorage.
   * Called by app.js at startup to decide whether to show the enrollment prompt.
   *
   * We validate the descriptor array length (=== 128) to guard against corrupt or
   * partially-written storage entries that could pass the parse check but crash recognition.
   *
   * @returns {boolean} true if a complete 128-d descriptor profile is stored, false otherwise.
   */
  hasEnrolledUser() {
    try {
      // Attempt to read the JSON string stored under the enrollment key.
      // Returns null if the key has never been set (first-run case).
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return false; // No enrollment record exists yet

      // Parse the JSON — could fail if the data was corrupted (e.g., partial write).
      const parsed = JSON.parse(stored);

      // Validate all required fields:
      //   - parsed.descriptor must exist and be a plain JS array (JSON can't store Float32Array)
      //   - Length must be exactly 128 — any other length means a corrupt or mismatched model version
      return !!(parsed && parsed.descriptor && Array.isArray(parsed.descriptor) && parsed.descriptor.length === 128);
    } catch (e) {
      // JSON.parse failure or localStorage security exception — treat as "not enrolled"
      // rather than crashing, since this is a soft existence check.
      console.warn('EnrollmentManager.hasEnrolledUser: localStorage read error', e);
      return false;
    }
  }

  /**
   * Retrieves the enrolled authorized user profile from localStorage and reconstructs
   * the Float32Array descriptor so it is immediately usable by FaceRecognizer.matchDescriptor().
   *
   * WHY Float32Array (not plain Array):
   * The face-api model outputs Float32Arrays. Storing as plain JSON arrays (numbers) is necessary
   * because JSON.stringify cannot serialize typed arrays. We convert back to Float32Array here so
   * calculateEuclideanDistance() receives the correct typed input, matching training precision.
   *
   * @returns {{ name: string, enrolledAt: string, descriptor: Float32Array } | null}
   *   The enrolled user profile, or null if no valid enrollment exists.
   */
  getEnrolledUser() {
    try {
      // Read the raw JSON string from browser-local storage (origin-isolated, never sent to a server).
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return null; // Nothing enrolled — caller should trigger the enrollment flow

      // Parse the stored JSON object back into a plain JS object.
      const parsed = JSON.parse(stored);

      return {
        // User's display name — defaults to 'Authorized User' if name was blank at enrollment time.
        name: parsed.name || 'Authorized User',

        // ISO-8601 timestamp of when the enrollment was originally completed.
        // Useful for showing "enrolled on <date>" in the UI and auditing stale enrollments.
        enrolledAt: parsed.enrolledAt || new Date().toISOString(),

        // Convert the stored plain number array back to a Float32Array.
        // This is necessary because JSON serialization flattens typed arrays to plain arrays,
        // and the recognition math requires typed float precision.
        descriptor: new Float32Array(parsed.descriptor)
      };
    } catch (e) {
      // Any error (JSON parse, missing field, storage quota exceeded) returns null
      // so the caller can gracefully re-prompt for enrollment.
      console.error('EnrollmentManager.getEnrolledUser error', e);
      return null;
    }
  }

  /**
   * Guides a multi-frame face capture session and stores the resulting master biometric template.
   *
   * PROCESS OVERVIEW:
   *   1. Validate that the recognizer and webcam are ready.
   *   2. Loop CONFIG.RECOGNITION.ENROLLMENT_SAMPLE_COUNT times (default: 5):
   *      a. Wait ENROLLMENT_SAMPLE_INTERVAL_MS (default: 350ms) between captures.
   *      b. Run the full detection + landmark + descriptor pipeline on the live video frame.
   *      c. Enforce exactly one face in frame (enrollment must be 1-to-1).
   *      d. Reject low-confidence detections (blurry, partial face).
   *      e. Store each good descriptor as a Float32Array.
   *   3. Average all 5 descriptor vectors dimension-by-dimension (noise cancellation).
   *   4. L2-normalize the averaged vector (geometric calibration for distance comparisons).
   *   5. Serialize and persist the profile to localStorage (numbers only, no images).
   *
   * @param {HTMLVideoElement} videoElement   - Active webcam stream element (must be playing)
   * @param {any} detectorOptions             - TinyFaceDetector or SSD options from FaceDetector
   * @param {string} userName                 - Display name for the enrolled user (shown in UI)
   * @param {(progress: { step: number, total: number, message: string }) => void} progressCallback
   *   Called after each sample capture so the UI can update a progress bar.
   * @returns {Promise<{ success: boolean, message: string, profile?: object }>}
   * @throws {Error} If the recognizer is not loaded, the webcam is not ready, or a sample fails quality checks.
   */
  async enrollFromVideo(videoElement, detectorOptions, userName = 'Primary User', progressCallback = () => {}) {
    // Guard: enrollment would fail silently if the recognition model is not loaded.
    // Throw explicitly so the caller can show a "models not loaded" error state.
    if (!this.faceRecognizer || !this.faceRecognizer.isReady()) {
      throw new Error('EnrollmentManager: Facial recognition model is not loaded.');
    }

    // Guard: videoElement.readyState < 2 means the camera is not yet streaming frames.
    // HTMLMediaElement.HAVE_CURRENT_DATA = 2 is the minimum state where a frame can be grabbed.
    if (!videoElement || videoElement.readyState < 2) {
      throw new Error('EnrollmentManager: Webcam video is not active or ready for frame capture.');
    }

    // Load the number of samples and inter-sample delay from CONFIG
    // so enrollment timing can be tuned without code changes.
    const totalSamples = CONFIG.RECOGNITION.ENROLLMENT_SAMPLE_COUNT;    // e.g. 5 — why: see module header
    const intervalMs = CONFIG.RECOGNITION.ENROLLMENT_SAMPLE_INTERVAL_MS; // e.g. 350ms — spread captures over ~1.75s

    // Will hold one Float32Array(128) per successfully captured sample.
    const collectedDescriptors = [];

    // Notify the UI that enrollment is about to begin — user should center their face.
    progressCallback({
      step: 0,
      total: totalSamples,
      message: 'Position your face in front of the camera and look directly at the screen...'
    });

    // ── SAMPLE CAPTURE LOOP ──────────────────────────────────────────────────
    for (let i = 0; i < totalSamples; i++) {
      // Wait between samples to allow the user's face and the webcam sensor to stabilize.
      // 350ms gives enough time for micro-movements to settle without making enrollment feel slow.
      await new Promise((r) => setTimeout(r, intervalMs));

      // Run the full face detection + landmark + descriptor pipeline on the current video frame.
      // This is a single frame snapshot — the pipeline does not accumulate across frames.
      const faces = await this.faceRecognizer.extractFacesWithDescriptors(videoElement, detectorOptions);

      // Reject frames where no face is found — user may have moved out of frame or lighting failed.
      // Throwing immediately gives clear feedback (vs. silently skipping and producing a bad template).
      if (faces.length === 0) {
        throw new Error(`Enrollment paused: No face detected on sample ${i + 1}. Please ensure good lighting and face the camera directly.`);
      }

      // Reject frames with multiple faces — if a bystander's face appears, the averaged
      // template would be a blend of two identities, making recognition unreliable.
      // The enrolling user must be alone in frame.
      if (faces.length > 1) {
        throw new Error(`Enrollment failed: Multiple faces (${faces.length}) detected during enrollment. Only the enrolling user must be in frame.`);
      }

      // Extract the single detected face result.
      const candidate = faces[0];

      // The face detector's confidence score — reflects how clearly the face was detected.
      const detectionScore = candidate.detection.score || 0;

      // Reject low-quality frames where the detector is not confident.
      // A low score often means the face is blurry, partially occluded, or at an extreme angle.
      // Storing a bad descriptor would permanently degrade matching accuracy.
      if (detectionScore < CONFIG.RECOGNITION.ENROLLMENT_MIN_CONFIDENCE) {
        throw new Error(`Enrollment sample ${i + 1} score was too low (${detectionScore.toFixed(2)}). Please look straight at the camera.`);
      }

      // Store a copy (new Float32Array) of this frame's 128-d descriptor.
      // We copy rather than reference because face-api may reuse internal buffer memory.
      collectedDescriptors.push(new Float32Array(candidate.descriptor));

      // Update the UI progress bar after each successful sample.
      progressCallback({
        step: i + 1,
        total: totalSamples,
        message: `Captured sample ${i + 1} of ${totalSamples}. Keep your head steady...`
      });
    }
    // ── END SAMPLE CAPTURE LOOP ──────────────────────────────────────────────

    // ── STEP 3: DIMENSION-WISE AVERAGING (noise cancellation) ───────────────
    // Create a 128-element zero-initialized array to accumulate sums.
    const averagedDescriptor = new Float32Array(128);

    // For each of the 128 dimensions, sum all sample values then divide by sample count.
    // This is equivalent to computing the centroid (geometric center) of the 5 descriptor points
    // in 128-D space — the centroid is less sensitive to any single outlier frame.
    for (let d = 0; d < 128; d++) {
      let sum = 0.0;
      for (let s = 0; s < collectedDescriptors.length; s++) {
        sum += collectedDescriptors[s][d]; // Accumulate the d-th dimension across all samples
      }
      averagedDescriptor[d] = sum / collectedDescriptors.length; // Store the mean value for dimension d
    }

    // ── STEP 4: L2 NORMALIZATION (geometric calibration) ────────────────────
    // Compute the L2 norm (Euclidean length) of the averaged descriptor vector.
    // norm = sqrt( sum_{d=0}^{127} averagedDescriptor[d]^2 )
    // After averaging, the vector's length may differ slightly from 1.0.
    // All Euclidean distance thresholds (0.52, 0.64) are calibrated for unit-norm vectors,
    // so we must rescale back to unit length before storing.
    let norm = 0.0;
    for (let d = 0; d < 128; d++) {
      norm += averagedDescriptor[d] * averagedDescriptor[d]; // Sum of squares
    }
    norm = Math.sqrt(norm); // Square root gives the vector's magnitude

    // Divide each dimension by the norm to project the vector onto the unit hypersphere.
    // After this step: ||averagedDescriptor||_2 ≈ 1.0 exactly.
    // Guard against norm = 0 (theoretical edge case — all 128 dimensions averaged to zero).
    if (norm > 0) {
      for (let d = 0; d < 128; d++) {
        averagedDescriptor[d] /= norm; // Scale down each component proportionally
      }
    }

    // ── STEP 5: PERSIST PROFILE TO localStorage (numbers only, no images) ───
    // Build the profile object. NOTICE: only the numeric descriptor array is stored.
    // No webcam image, no JPEG, no canvas frame — only 128 × 4 bytes = 512 bytes of floats.
    const profile = {
      name: userName.trim() || 'Primary User', // Strip whitespace; fallback if name was empty
      enrolledAt: new Date().toISOString(),     // ISO-8601 timestamp for audit / display
      sampleCount: totalSamples,               // Stored for informational purposes (UI / debugging)
      descriptor: Array.from(averagedDescriptor) // Convert Float32Array → plain Array for JSON serialization
                                                  // (JSON.stringify cannot directly serialize typed arrays)
    };

    // Persist to browser localStorage.
    // localStorage is origin-isolated — only code running on the same domain+port can read it.
    // The data is stored as a JSON string since localStorage only supports string values.
    localStorage.setItem(this.storageKey, JSON.stringify(profile));

    // Notify the UI that enrollment is fully complete.
    progressCallback({
      step: totalSamples,
      total: totalSamples,
      message: 'Enrollment successfully completed! Master biometric vector stored locally.'
    });

    // Return a structured result object so app.js can update the UI state accordingly.
    return {
      success: true,
      message: `User '${profile.name}' successfully enrolled with ${totalSamples} multi-frame samples.`,
      profile  // Include the full profile so the caller can display enrollment details without re-reading storage
    };
  }

  /**
   * Removes the enrolled biometric template from browser localStorage.
   * Used when the user wants to re-enroll a different person or reset the system.
   *
   * After deletion, hasEnrolledUser() returns false and the security engine will
   * revert to NO_USER_DETECTED / CAUTION state on the next inference cycle.
   *
   * @returns {{ success: boolean, message: string }}
   */
  deleteEnrollment() {
    try {
      // Remove the specific key — does not affect any other localStorage entries.
      localStorage.removeItem(this.storageKey);
      return { success: true, message: 'Enrolled user data deleted successfully.' };
    } catch (e) {
      // localStorage.removeItem can fail if storage is locked by browser security policy.
      console.error('EnrollmentManager.deleteEnrollment error', e);
      return { success: false, message: 'Failed to delete enrollment data from storage.' };
    }
  }
}
