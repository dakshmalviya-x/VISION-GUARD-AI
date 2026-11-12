/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Face Detection Module (js/face-detection.js)
 *
 * Maintained primarily by Member 1 (Face Detection and Facial Recognition)
 *
 * RESPONSIBILITY:
 * 1. Load and initialize the real computer vision face-detection model.
 * 2. Locate all human faces in a given video frame.
 * 3. Return bounding box coordinates and detection confidence scores.
 *
 * CRITICAL VIVA / ARCHITECTURE DISTINCTION:
 * Face detection only answers: "WHERE are the faces in the frame?"
 * It does NOT identify WHO the person is (that is the job of face-recognition.js).
 *
 * ─── DETECTOR COMPARISON (important for viva) ────────────────────────────────
 *
 * TinyFaceDetector (selected when CONFIG.MODELS.PREFER_TINY_DETECTOR = true)
 *   Architecture : Depthwise-separable CNN (MobileNet-style)
 *   Model size   : ~190 KB — tiny download, fast to load from disk
 *   Speed        : ~30 fps on a CPU-only laptop at inputSize 320
 *   Accuracy     : Good for frontal faces; can miss extreme angles or small faces
 *   Best for     : Real-time webcam monitoring, single-user close-up scenarios
 *   WHY chosen   : VisionGuard's primary use case is a user sitting in front of a
 *                  laptop — TinyFaceDetector is perfectly suited and keeps the UI
 *                  smooth without requiring a GPU.
 *
 * SSD MobileNet V1 (selected when PREFER_TINY_DETECTOR = false)
 *   Architecture : Single-Shot MultiBox Detector on MobileNet V1 backbone
 *   Model size   : ~5.4 MB — larger download, slower to load
 *   Speed        : ~10–15 fps on CPU (significantly slower than Tiny)
 *   Accuracy     : Higher — handles side profiles, small faces, partial occlusion
 *   Best for     : High-security scenarios where missing a face is unacceptable
 *   WHY available: Provided as a drop-in fallback for environments where accuracy
 *                  matters more than frame rate (e.g., access-control at a door).
 *
 * Both models are part of the face-api.js library bundled at js/vendor/face-api.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Import the shared configuration so model paths and detector settings
// are not hard-coded here — changes in config.js automatically apply here.
import { CONFIG } from './config.js';

export class FaceDetector {
  /**
   * Initialises instance state to a "not-yet-loaded" baseline.
   * No network requests or file I/O happen in the constructor — the first
   * real work happens when loadModel() is called.  This keeps construction
   * cheap and side-effect-free.
   */
  constructor() {
    // Flag that becomes true only after loadModel() completes successfully.
    // Every public method checks this before attempting inference.
    this.isModelLoaded = false;

    // Tracks which detector is currently active ('tiny' or 'ssd').
    // Useful for logging and for conditional behaviour in future extensions.
    this.detectorType = 'tiny'; // 'tiny' = TinyFaceDetector, 'ssd' = SSD MobileNet

    // The detector options object (TinyFaceDetectorOptions or SsdMobilenetv1Options).
    // This is passed into every detectAllFaces() call to configure inference.
    // Null until loadModel() constructs the correct options instance.
    this.detectorOptions = null;

    // Local reference to the global window.faceapi library object.
    // Storing it here avoids repeated window property lookups during inference
    // and makes it easy to swap in a mock during unit testing.
    this.faceapi = null;
  }

  /**
   * Initializes the face detection model from the offline models directory.
   *
   * This method does two things:
   *   1. Downloads (or reads from browser cache) the neural network weight
   *      files from the given path.
   *   2. Constructs the options object that configures the detector's behaviour.
   *
   * It is idempotent — calling it a second time is a no-op if already loaded.
   *
   * @param {string} modelsPath - Path where model weights manifests (.json) and
   *                              binary shards (-weights.bin) reside on disk.
   *                              Defaults to CONFIG.MODELS.BASE_PATH ('./models').
   * @returns {Promise<boolean>} Resolves to true when the model is ready.
   * @throws {Error} with category 'MODEL_ERROR' if loading fails (bad path, 404, etc.)
   */
  async loadModel(modelsPath = CONFIG.MODELS.BASE_PATH) {
    // Idempotency guard: if the model is already in memory, skip loading.
    // This can happen if loadModel() is called twice during app initialisation
    // (e.g., once from main.js and once from a hot-reload during development).
    if (this.isModelLoaded) {
      return true;
    }

    // face-api.js is loaded via a <script> tag in index.html and exposes itself
    // as window.faceapi. We verify it exists before proceeding because if the
    // <script> tag is missing or fails to load, the error below is much clearer
    // than a cryptic "Cannot read properties of undefined" crash later.
    if (typeof window.faceapi === 'undefined') {
      throw new Error(
        'FaceDetector: face-api.js library is not loaded. Ensure js/vendor/face-api.js is included in index.html before scripts.'
      );
    }

    // Store a local reference for convenience and testability (see constructor comment).
    this.faceapi = window.faceapi;

    try {
      if (CONFIG.MODELS.PREFER_TINY_DETECTOR) {
        // ── BRANCH A: TinyFaceDetector ────────────────────────────────────────
        // loadFromUri() fetches the model's JSON manifest from the given path and
        // then fetches each referenced weight shard in parallel. The browser
        // caches these files after the first load, making subsequent starts fast.
        //
        // WHY TinyFaceDetector for real-time webcam?
        //   Its depthwise-separable convolutions reduce multiply-accumulate
        //   operations by ~8–9× compared to a standard CNN of similar capacity,
        //   making it fast enough for 30 fps CPU inference on a laptop.
        await this.faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath);

        // Construct the options object that the detector reads on every call.
        // Values come from CONFIG so they can be tuned in one place.
        this.detectorOptions = new this.faceapi.TinyFaceDetectorOptions({
          // inputSize: frame is internally scaled to this resolution before inference.
          // 320 is the best balance of speed and accuracy for a 640×480 feed.
          inputSize: CONFIG.MODELS.TINY_FACE_DETECTOR_OPTIONS.inputSize,

          // scoreThreshold: detections below this confidence are discarded.
          // 0.5 means "at least 50 % confident this is a real face".
          scoreThreshold: CONFIG.MODELS.TINY_FACE_DETECTOR_OPTIONS.scoreThreshold
        });

        // Record which detector type is active for logging and debugging.
        this.detectorType = 'tiny';

      } else {
        // ── BRANCH B: SSD MobileNet V1 ────────────────────────────────────────
        // This is a heavier but more accurate model. It is selected when the
        // operator needs to detect faces at greater distances, steeper angles, or
        // partial occlusions where TinyFaceDetector would struggle.
        //
        // WHY SSD (Single-Shot MultiBox Detector)?
        //   SSD evaluates multiple anchor boxes at multiple scales in a single
        //   forward pass, making it both accurate and faster than two-stage
        //   detectors (like Faster R-CNN) while still handling a wider range of
        //   face sizes than TinyFaceDetector.
        await this.faceapi.nets.ssdMobilenetv1.loadFromUri(modelsPath);

        // Construct SSD-specific options with the shared minimum confidence floor.
        this.detectorOptions = new this.faceapi.SsdMobilenetv1Options({
          // minConfidence: same 50 % floor as TinyFaceDetector for consistency.
          minConfidence: CONFIG.MODELS.SSD_MOBILENET_OPTIONS.minConfidence
        });

        this.detectorType = 'ssd';
      }

      // Mark loading as complete so detectFaces() is now allowed to run.
      this.isModelLoaded = true;
      return true;

    } catch (err) {
      // Ensure isModelLoaded stays false if loading failed partway through.
      // Without this, a partial load could leave the detector in an unusable
      // state while isModelLoaded reports true.
      this.isModelLoaded = false;

      // Wrap the low-level error (usually a network/404 error) in a descriptive
      // message that tells the developer exactly which path was attempted.
      const error = new Error(
        `Failed to load face detection neural network weights from '${modelsPath}'. ` +
        `Details: ${err.message || err}`
      );

      // category matches CONFIG.SECURITY.STATES.MODEL_ERROR so the security
      // engine can set the system state correctly when it catches this error.
      error.category = 'MODEL_ERROR';

      // Attach original error for debuggability in the browser DevTools console.
      error.originalError = err;

      throw error;
    }
  }

  /**
   * Detects all faces present in the given input source (video frame or image).
   *
   * This is the core inference method. It passes one frame into the neural
   * network and gets back an array of bounding boxes with confidence scores.
   * The results are reformatted into a simple, framework-independent structure
   * so the rest of VisionGuard doesn't need to know about face-api.js internals.
   *
   * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement} inputSource
   *        The visual element to run face detection on. Usually the live <video>
   *        element streaming from the webcam. Can also be a canvas (for testing
   *        with captured frames) or an image element.
   *
   * @returns {Promise<Array<{
   *   box: { x: number, y: number, width: number, height: number },
   *   score: number,
   *   rawDetection: any
   * }>>}
   *   An array of face detection results (may be empty if no faces found).
   *   - box: Pixel coordinates of the bounding box, rounded to integers.
   *   - score: Confidence score rounded to 3 decimal places (0.000–1.000).
   *   - rawDetection: The original face-api.js detection object, kept for
   *                   use by face-recognition.js which needs internal fields.
   */
  async detectFaces(inputSource) {
    // Guard: refuse to run inference if the model hasn't been loaded yet.
    // Calling detectFaces() before loadModel() would throw a confusing error
    // deep inside face-api.js; this gives a clear, actionable message instead.
    if (!this.isModelLoaded) {
      throw new Error('FaceDetector.detectFaces: Model has not been loaded. Call loadModel() first.');
    }

    // Guard: return empty array immediately for null/undefined input rather than
    // letting face-api.js throw its own less-helpful error message.
    if (!inputSource) {
      return [];
    }

    // For HTMLVideoElement inputs, verify the stream is in a usable state.
    // readyState < 2 (HAVE_CURRENT_DATA) means no frame data is available yet.
    // paused or ended means the camera has been stopped — inferring on a frozen
    // or blank frame wastes CPU and would return stale results.
    if (inputSource instanceof HTMLVideoElement) {
      if (inputSource.readyState < 2 || inputSource.paused || inputSource.ended) {
        // Return empty quietly — this is a normal transient condition at startup
        // or shutdown, not an error that needs logging.
        return [];
      }
    }

    try {
      // Core inference call — this is where the neural network runs.
      // detectAllFaces() scans the entire frame and returns all detected faces.
      // The detector type (Tiny vs SSD) is baked into this.detectorOptions,
      // so this single call works unchanged for both model choices.
      const detections = await this.faceapi.detectAllFaces(inputSource, this.detectorOptions);

      // If the network found nothing, return an empty array.
      // Downstream code (security engine, recognition) handles empty arrays
      // gracefully — no special "null face" sentinel value needed.
      if (!detections || detections.length === 0) {
        return [];
      }

      // Reformat each raw face-api.js detection into a plain object that:
      //   - Has a predictable, documented shape (box + score + rawDetection)
      //   - Uses integer pixel coordinates (Math.round) for clean canvas drawing
      //   - Has a score with controlled precision (3 decimal places) for display
      //   - Keeps rawDetection so face-recognition.js can extract embeddings
      return detections.map((det) => ({
        box: {
          // x, y: top-left corner of the bounding box in pixel coordinates
          x: Math.round(det.box.x),
          y: Math.round(det.box.y),
          // width, height: extent of the box — used to draw the rectangle overlay
          width: Math.round(det.box.width),
          height: Math.round(det.box.height)
        },
        // score: how confident the model is that this bounding box contains a face.
        // Rounded to 3 decimal places to avoid floating-point noise in comparisons
        // and to make it readable when displayed in the UI (e.g., "0.873").
        score: parseFloat(det.score.toFixed(3)),

        // rawDetection: the original face-api.js FaceDetection object.
        // face-recognition.js needs this to call faceapi.computeFaceDescriptor()
        // which requires the original detection to know the aligned face region.
        rawDetection: det
      }));

    } catch (err) {
      // Inference errors can happen transiently (browser tab backgrounded, GPU
      // driver hiccup, frame torn during rapid camera movement). Logging a
      // warning and returning empty keeps the security loop running rather than
      // crashing the whole application on a single bad frame.
      console.warn('FaceDetector.detectFaces: Inference warning', err);
      return [];
    }
  }

  /**
   * Status query — lets other modules check if the detector is ready to use
   * without having to access the internal isModelLoaded property directly.
   *
   * Encapsulating this behind a method means we can add more complex readiness
   * checks (e.g., GPU warm-up, test inference) in the future without changing
   * the public API that the rest of the application relies on.
   *
   * @returns {boolean} true if loadModel() has completed successfully
   */
  isReady() {
    return this.isModelLoaded;
  }
}
