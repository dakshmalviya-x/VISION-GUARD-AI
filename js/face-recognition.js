/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Facial Recognition Module (js/face-recognition.js)
 *
 * Maintained primarily by Member 1 (Face Detection and Facial Recognition)
 *
 * RESPONSIBILITY:
 * 1. Load the deep Face Recognition neural network (ResNet-34 metric learning).
 * 2. Compute 128-dimensional floating-point facial embedding vectors (face descriptors).
 * 3. Calculate Euclidean distance between biometric embeddings.
 * 4. Determine whether a detected person matches the enrolled authorized identity.
 *
 * CRITICAL VIVA DISTINCTION:
 * Face recognition answers: "WHO is this person?"
 * In face recognition, a CNN maps facial features (eye spacing, nose bridge shape, jaw contours)
 * to a 128-dimensional vector space. Faces of the same individual map close together (small Euclidean distance),
 * while faces of different individuals map far apart (large Euclidean distance).
 *
 * HOW THE 128-D RESNET EMBEDDING WORKS:
 * face-api.js bundles a ResNet-34 based network trained using metric learning (similar to FaceNet / dlib's approach).
 * Given a face chip (cropped & aligned), the network outputs a 128-element Float32 vector — the "descriptor".
 * Each dimension encodes a learned abstract biometric feature (not human-interpretable).
 * The key property: same-person descriptors cluster tightly; different-person descriptors spread apart in the 128-D space.
 *
 * EUCLIDEAN DISTANCE FORMULA USED FOR COMPARISON:
 * d(A, B) = sqrt( sum_{i=0}^{127} (A[i] - B[i])^2 )
 * where A and B are two 128-element descriptor vectors.
 * A distance near 0.0 means very similar faces; a distance near 1.2+ means very different faces.
 *
 * 3-TIER MATCH CLASSIFICATION (thresholds from CONFIG):
 *   AUTHORIZED  → distance < 0.52  — confident same-person match, grant access
 *   UNCERTAIN   → 0.52 ≤ d ≤ 0.64 — ambiguous zone, possible lighting/angle variance
 *   UNKNOWN     → distance > 0.64  — confident mismatch, treat as unauthorized
 */

// Import centralized configuration so all thresholds are managed in one place.
import { CONFIG } from './config.js';

// FaceRecognizer is exported as a class so app.js can instantiate exactly one instance.
export class FaceRecognizer {
  constructor() {
    // Flag that becomes true only after both required neural network models load successfully.
    // Guards every public method against being called before the models are ready.
    this.isModelLoaded = false;

    // Holds the reference to the global window.faceapi library after it is confirmed present.
    // Using an instance property (instead of always reading window.faceapi) keeps the code
    // testable and avoids repeated global lookups.
    this.faceapi = null;
  }

  /**
   * Initializes the Face Recognition and Facial Landmark models.
   *
   * Two models must be loaded together because the recognition pipeline is a chain:
   *   Step 1 — faceLandmark68Net  : detects 68 precise facial keypoints on the cropped face.
   *   Step 2 — faceRecognitionNet : uses those aligned keypoints to compute the 128-d descriptor.
   * Without landmarks the network cannot align the face chip, so landmark detection is a prerequisite.
   *
   * Models are loaded from the local /models directory (offline) so the app works without internet.
   * The loadFromUri guard (`if (!net.isLoaded)`) prevents redundant re-downloads if loadModel()
   * is called more than once (e.g., after an error recovery attempt).
   *
   * @param {string} modelsPath - Path to offline models directory (default from CONFIG)
   * @returns {Promise<boolean>} Resolves to true when models are ready.
   * @throws {Error} Throws a categorized MODEL_ERROR if any model fails to load.
   */
  async loadModel(modelsPath = CONFIG.MODELS.BASE_PATH) {
    // Skip loading if models are already in memory — avoids redundant network/disk reads.
    if (this.isModelLoaded) {
      return true;
    }

    // face-api.js is loaded via a <script> tag in index.html and exposed as window.faceapi.
    // If that script tag is missing or failed to parse, we throw immediately with a clear message
    // rather than letting a cryptic "undefined is not an object" error surface later.
    if (typeof window.faceapi === 'undefined') {
      throw new Error('FaceRecognizer: window.faceapi is missing. Ensure vendor library is loaded.');
    }

    // Store reference to the global library on the instance so the rest of the class
    // doesn't need to reference window.faceapi directly (cleaner, easier to mock in tests).
    this.faceapi = window.faceapi;

    try {
      // 1. Load the 68-point facial landmark detector first.
      //    This model identifies the positions of eyes, nose, mouth, and jaw outline —
      //    critical for the affine face-alignment step that precedes descriptor extraction.
      //    The `if (!isLoaded)` guard avoids re-downloading if face-detection.js already loaded it.
      if (!this.faceapi.nets.faceLandmark68Net.isLoaded) {
        await this.faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath);
      }

      // 2. Load the ResNet-34 face recognition network.
      //    This is the model that converts an aligned face chip into a 128-dimensional
      //    floating-point descriptor vector used for identity comparison.
      //    It is kept separate from the detector so it can be loaded on-demand (lazy loading).
      if (!this.faceapi.nets.faceRecognitionNet.isLoaded) {
        await this.faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath);
      }

      // Both models loaded — mark the recognizer as ready for use.
      this.isModelLoaded = true;
      return true;
    } catch (err) {
      // Reset flag so callers can retry loadModel() after fixing the root cause (e.g., wrong path).
      this.isModelLoaded = false;

      // Wrap the low-level error with a human-readable message and a machine-readable category
      // so the calling code (app.js) can distinguish MODEL_ERROR from CAMERA_ERROR, etc.
      const error = new Error(
        `Failed to load facial recognition models from '${modelsPath}'. Details: ${err.message || err}`
      );
      error.category = 'MODEL_ERROR';    // Structured category for error handling in app.js
      error.originalError = err;         // Preserve stack trace of the original cause
      throw error;
    }
  }

  /**
   * Runs the full face-api detection pipeline in one chained call:
   *   detectAllFaces → withFaceLandmarks → withFaceDescriptors
   *
   * "detectAllFaces" finds bounding boxes for every face in the frame.
   * "withFaceLandmarks" runs the 68-point landmark model on each detected face,
   *   returning the precise pixel coordinates of eyes, nose, mouth, and jaw.
   * "withFaceDescriptors" then aligns each face chip using the landmarks and
   *   feeds it through the ResNet-34 network to produce the 128-d descriptor vector.
   *
   * Returns an empty array (rather than throwing) on failure so the calling loop
   * can simply skip a bad frame and try again on the next animation frame.
   *
   * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement} inputSource - The live frame source
   * @param {any} detectorOptions - Detector options object from FaceDetector (TinyFaceDetector or SSD)
   * @returns {Promise<Array<{ detection: any, landmarks: any, descriptor: Float32Array }>>}
   *   An array of result objects — one per face found — each containing:
   *   - detection : bounding box + confidence score from the face detector
   *   - landmarks : 68 {x,y} point objects for facial feature positions
   *   - descriptor : Float32Array(128) — the biometric embedding vector for this face
   */
  async extractFacesWithDescriptors(inputSource, detectorOptions) {
    // Guard: calling before loadModel() completes would cause cryptic errors inside face-api.
    // A clear thrown error here tells the developer exactly what went wrong.
    if (!this.isModelLoaded) {
      throw new Error('FaceRecognizer: Model not loaded. Call loadModel() first.');
    }

    // A null/undefined source (e.g., camera not yet started) returns empty rather than crashing.
    if (!inputSource) {
      return [];
    }

    try {
      // Run the chained face-api pipeline. The result is an array of DetectionWithLandmarksAndDescriptor objects.
      // This single await resolves after all three stages complete for every detected face.
      const results = await this.faceapi
        .detectAllFaces(inputSource, detectorOptions)  // Stage 1: bounding boxes
        .withFaceLandmarks()                           // Stage 2: 68-point landmarks per face
        .withFaceDescriptors();                        // Stage 3: 128-d descriptor per face

      return results; // May be an empty array if no faces are found in this frame
    } catch (err) {
      // Non-fatal warning: a single bad frame (blur, occlusion, GPU hiccup) shouldn't crash the loop.
      console.warn('FaceRecognizer.extractFacesWithDescriptors error', err);
      return []; // Return empty array so the inference loop can continue on the next frame
    }
  }

  /**
   * Computes the Euclidean Distance between two 128-dimensional descriptor vectors.
   *
   * MATHEMATICAL FORMULA:
   *   d(A, B) = sqrt( sum_{i=0}^{127} (A[i] - B[i])^2 )
   *
   * WHY EUCLIDEAN DISTANCE:
   * The ResNet embedding space is trained so that same-identity faces land close together
   * and different-identity faces land far apart in straight-line (Euclidean) geometric terms.
   * This means the raw L2 distance is directly interpretable as a "similarity score":
   *   ~0.0  = almost identical faces (same photo)
   *   ~0.4  = same person, different lighting/expression
   *   ~0.6  = borderline / uncertain
   *   ~0.8+ = definitively different people
   *
   * We implement this manually (rather than using faceapi.euclideanDistance) so the
   * calculation is fully transparent, auditable, and consistent across all call sites.
   *
   * @param {Float32Array|Array<number>} descriptorA - First 128-d biometric vector
   * @param {Float32Array|Array<number>} descriptorB - Second 128-d biometric vector
   * @returns {number} Euclidean distance — typically between 0.2 and 1.2 for real faces.
   *                   Returns Infinity for null/mismatched inputs to safely fail comparisons.
   */
  calculateEuclideanDistance(descriptorA, descriptorB) {
    // Guard against null inputs — Infinity signals "incomparable" to the caller.
    if (!descriptorA || !descriptorB) {
      return Infinity;
    }

    // Both descriptors must be 128-dimensional; mismatched lengths would produce a mathematically
    // meaningless distance, so we return Infinity to signal the error rather than silently returning garbage.
    if (descriptorA.length !== descriptorB.length) {
      console.warn('Descriptor length mismatch in calculateEuclideanDistance');
      return Infinity;
    }

    // Accumulate the squared difference for each of the 128 dimensions.
    // Using a plain for-loop (not reduce) for maximum performance since this may run
    // every ~110ms per face in the inference loop.
    let sumOfSquares = 0.0;
    for (let i = 0; i < descriptorA.length; i++) {
      const diff = descriptorA[i] - descriptorB[i]; // Per-dimension difference
      sumOfSquares += diff * diff;                   // Square and accumulate (squaring removes sign)
    }

    // Square-root converts the sum of squared differences into a true geometric distance.
    return Math.sqrt(sumOfSquares);
  }

  /**
   * Compares a live candidate face descriptor against the enrolled authorized user's descriptor
   * and classifies the result into one of three security tiers.
   *
   * 3-TIER CLASSIFICATION SYSTEM:
   * ┌───────────────┬───────────────────────┬──────────────────────────────────────────────────┐
   * │ Tier          │ Distance Range        │ Meaning                                          │
   * ├───────────────┼───────────────────────┼──────────────────────────────────────────────────┤
   * │ AUTHORIZED    │ d < 0.52              │ High-confidence same-person — grant access        │
   * │ UNCERTAIN     │ 0.52 ≤ d ≤ 0.64      │ Ambiguous — lighting/angle variance, hold state  │
   * │ UNKNOWN       │ d > 0.64              │ Confident mismatch — treat as unauthorized        │
   * └───────────────┴───────────────────────┴──────────────────────────────────────────────────┘
   *
   * WHY THESE THRESHOLDS:
   * They were chosen empirically based on dlib/face-api benchmark data:
   *   - 0.52 keeps false-accept rate (FAR) extremely low (nearly no stranger accepted as the user).
   *   - 0.64 keeps false-reject rate (FRR) acceptable (the real user is rarely locked out).
   *   - The gap between them (0.52–0.64) is an UNCERTAIN buffer zone where the system
   *     neither fully trusts nor fully rejects — it maintains the last-known state.
   *
   * @param {Float32Array} candidateDescriptor - 128-d vector of the detected (live) face
   * @param {Float32Array} enrolledDescriptor  - 128-d vector of the authorized user stored at enrollment
   * @returns {{
   *   isMatch: boolean,          // true only for AUTHORIZED tier
   *   distance: number,          // raw Euclidean distance (4 decimal places)
   *   matchStatus: 'AUTHORIZED' | 'UNCERTAIN' | 'UNKNOWN',
   *   confidencePercent: number, // 0–100 human-readable similarity score
   *   explanation: string        // human-readable verdict for UI display / logging
   * }}
   */
  matchDescriptor(candidateDescriptor, enrolledDescriptor) {
    // If no user has been enrolled yet, every face is unknown by definition.
    // Returning a structured object (rather than throwing) keeps the calling loop clean.
    if (!enrolledDescriptor) {
      return {
        isMatch: false,
        distance: 1.0,                // Treat as max-distance (complete mismatch)
        matchStatus: 'UNKNOWN',
        confidencePercent: 0,
        explanation: 'No authorized user has been enrolled yet. Treating identity as unknown.'
      };
    }

    // Compute the raw L2 distance between the two 128-d embeddings.
    const distance = this.calculateEuclideanDistance(candidateDescriptor, enrolledDescriptor);

    // Pull thresholds from CONFIG so they can be tuned in one place without touching this logic.
    const matchThreshold = CONFIG.RECOGNITION.MATCH_THRESHOLD;         // e.g. 0.52 — AUTHORIZED ceiling
    const uncertainThreshold = CONFIG.RECOGNITION.UNCERTAIN_THRESHOLD; // e.g. 0.64 — UNCERTAIN ceiling

    // Convert the raw Euclidean distance into an intuitive 0–100% similarity score for the UI.
    // Formula: at distance 0.0 → 100% similar; at distance = uncertainThreshold → 0% similar.
    // Math.min(100, ...) clamps the top; Math.max(0, ...) prevents negative percentages.
    const similarityPercent = Math.max(
      0,
      Math.min(100, Math.round((1 - distance / uncertainThreshold) * 100))
    );

    // --- Tier 1: AUTHORIZED ---
    // Distance is below the strict match threshold — confident same-person identification.
    if (distance < matchThreshold) {
      return {
        isMatch: true,                              // The only tier that sets isMatch true
        distance: parseFloat(distance.toFixed(4)), // 4 decimal places for telemetry
        matchStatus: 'AUTHORIZED',
        confidencePercent: similarityPercent,
        explanation: `Confident match with enrolled user (Euclidean distance: ${distance.toFixed(3)} < ${matchThreshold}).`
      };

    // --- Tier 2: UNCERTAIN ---
    // Distance falls between the two thresholds — the face could be the authorized user
    // at an awkward angle or in poor lighting. The security engine will hold its current state.
    } else if (distance <= uncertainThreshold) {
      return {
        isMatch: false,                             // Not confirmed — do NOT grant access
        distance: parseFloat(distance.toFixed(4)),
        matchStatus: 'UNCERTAIN',
        confidencePercent: similarityPercent,
        explanation: `Identity uncertain (Distance: ${distance.toFixed(3)} is between ${matchThreshold} and ${uncertainThreshold}).`
      };

    // --- Tier 3: UNKNOWN ---
    // Distance exceeds the uncertain threshold — confident mismatch; this is a different person.
    } else {
      return {
        isMatch: false,                             // Definitively not the enrolled user
        distance: parseFloat(distance.toFixed(4)),
        matchStatus: 'UNKNOWN',
        confidencePercent: similarityPercent,       // Will be 0 or very close to 0
        explanation: `Identity mismatch (Distance: ${distance.toFixed(3)} > ${uncertainThreshold}). Unauthorized viewer.`
      };
    }
  }

  /**
   * Returns whether the recognition model is loaded and ready for use.
   * Used by other modules (e.g., EnrollmentManager) to check readiness before calling extractFacesWithDescriptors.
   * @returns {boolean}
   */
  isReady() {
    return this.isModelLoaded;
  }
}
