/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Central Configuration Module (js/config.js)
 *
 * Maintained primarily by Member 2 (Security Decision Engine & Gaze Estimation)
 * in close coordination with Member 1 and Member 3.
 *
 * All thresholds, timing parameters, model paths, and UI settings
 * are centralized here to maintain modularity, testability, and explainability.
 *
 * WHY a single config file?
 *   Keeping every "magic number" in one place means you only need to change it
 *   here and the entire application updates — no hunting through multiple files.
 *   It also makes the system easy to tune during demonstrations or viva.
 */

// Object.freeze() makes the whole CONFIG object deeply immutable at runtime,
// preventing any module from accidentally overwriting a threshold mid-session.
export const CONFIG = Object.freeze({

  // ─────────────────────────────────────────────────────────────────────────
  // MODEL LOADING AND ASSETS
  // These settings control which neural-network models are used for face
  // detection and where their weight files are stored on disk.
  // ─────────────────────────────────────────────────────────────────────────
  MODELS: {
    // Relative path (from index.html) to the folder that holds the model
    // weight manifest files (.json) and binary shards (-weights.bin).
    // Keeping models local means the app works fully offline — no CDN calls.
    BASE_PATH: './models',

    // Options passed directly to the TinyFaceDetector neural network.
    // TinyFaceDetector is a small, fast model that uses depthwise-separable
    // convolutions, making it ideal for real-time (30 fps) webcam inference
    // on a laptop CPU without needing a dedicated GPU.
    TINY_FACE_DETECTOR_OPTIONS: {
      // inputSize (pixels): The resolution the input frame is internally
      // rescaled to before being passed into the neural network.
      // Allowed values: 160, 224, 320, 416, 512, 608
      //   • Smaller (160) = faster but misses small or distant faces.
      //   • Larger (608)  = more accurate but significantly slower.
      //   • 320 is the sweet-spot for a 640×480 webcam at ~30 fps on a laptop.
      inputSize: 320,

      // scoreThreshold (0.0–1.0): Minimum confidence score a detection must
      // reach before it is returned as a valid face.
      //   • Too low  (< 0.3): Lots of false positives — hands, pillows, etc.
      //   • Too high (> 0.7): Misses partially-occluded or side-profile faces.
      //   • 0.5 is the conventional "50 % confident = worth reporting" baseline.
      scoreThreshold: 0.5
    },

    // Options for SSD MobileNet V1, the alternative (higher-accuracy) detector.
    // SSD MobileNet uses a full Single-Shot MultiBox Detector architecture,
    // which is more accurate than TinyFaceDetector but slower to infer per frame.
    // This block is only used when PREFER_TINY_DETECTOR is set to false below.
    SSD_MOBILENET_OPTIONS: {
      // minConfidence (0.0–1.0): Same role as scoreThreshold above but for SSD.
      // 0.5 keeps the same 50 % confidence floor so behaviour is consistent
      // regardless of which model is active.
      minConfidence: 0.5
    },

    // PREFER_TINY_DETECTOR (boolean): Master switch that selects the detector.
    //   true  → TinyFaceDetector (default) — fast, low CPU, good for 30 fps.
    //   false → SSD MobileNet V1           — slower, higher accuracy.
    // For a live-demo setting on a standard laptop, leave this as true.
    // Switch to false only if detection reliability needs to be maximised and
    // you can tolerate a lower frame rate (~10–15 fps).
    PREFER_TINY_DETECTOR: true
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FACE RECOGNITION & IDENTITY MATCHING  (Member 1)
  // face-api.js encodes every face into a 128-dimensional embedding vector.
  // Two vectors are compared with Euclidean distance:
  //   distance = sqrt( sum( (a_i - b_i)^2 ) for i in 0..127 )
  // A distance of 0.0 means identical embeddings; higher = more different.
  // The thresholds below divide the continuous distance scale into three zones.
  // ─────────────────────────────────────────────────────────────────────────
  RECOGNITION: {
    // MATCH_THRESHOLD (dimensionless Euclidean distance, range 0.0–2.0 typical):
    // If the distance between the live embedding and the enrolled embedding is
    // LESS than this value, we are highly confident it is the same person.
    // Result → "Authorized User"
    // Typical tuned range: 0.45–0.55 for 128-D face embeddings.
    // Lower = stricter (fewer false accepts), higher = more lenient.
    MATCH_THRESHOLD: 0.52,

    // UNCERTAIN_THRESHOLD (dimensionless Euclidean distance):
    // If distance is between MATCH_THRESHOLD and UNCERTAIN_THRESHOLD, the
    // system cannot confidently accept or reject the person.
    // Result → "Uncertain / Borderline Identity" (amber state)
    // Values above UNCERTAIN_THRESHOLD are treated as a definite mismatch.
    // Result → "Unknown / Unauthorized Person"
    UNCERTAIN_THRESHOLD: 0.64,

    // ENROLLMENT_SAMPLE_COUNT (integer, unit: frames):
    // How many separate facial snapshots to capture from the user during
    // the enrollment (registration) process. Averaging multiple embeddings
    // across slightly different poses/expressions improves robustness.
    ENROLLMENT_SAMPLE_COUNT: 5,

    // ENROLLMENT_SAMPLE_INTERVAL_MS (milliseconds):
    // How long to wait between consecutive enrollment snapshots.
    // 350 ms gives the user time to shift expression slightly between shots
    // so the enrolled embedding set covers natural variation.
    ENROLLMENT_SAMPLE_INTERVAL_MS: 350,

    // ENROLLMENT_MIN_CONFIDENCE (0.0–1.0):
    // A snapshot frame is only used for enrollment if the detector's confidence
    // score meets or exceeds this value. Rejects blurry or partially-visible
    // face frames that would pollute the enrolled embedding average.
    ENROLLMENT_MIN_CONFIDENCE: 0.65,

    // STORAGE_KEY (string): localStorage key name used to persist the enrolled
    // identity embedding between browser sessions. The "_v1" suffix allows
    // future schema versions to coexist without collision.
    STORAGE_KEY: 'visionguard_enrolled_identity_v1'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LANDMARK-BASED GAZE & HEAD POSE ESTIMATION  (Member 2)
  // The gaze module uses 68 facial landmark points from face-api.js to
  // estimate where the user's eyes are directed and whether their head is
  // turned away from the monitor. The thresholds below define the acceptable
  // "looking at screen" zone in terms of head angles and eye measurements.
  // ─────────────────────────────────────────────────────────────────────────
  GAZE: {
    // YAW_SCREEN_THRESHOLD_DEG (degrees, range: 0–90):
    // Yaw is the left-right rotation of the head (like shaking your head "no").
    // If |yaw| ≤ this value, the user is considered to be facing the screen.
    // 22° allows natural slight head turns without triggering an alert, while
    // still catching a user who has turned to look at another person or screen.
    YAW_SCREEN_THRESHOLD_DEG: 22.0,

    // PITCH_SCREEN_THRESHOLD_DEG (degrees, range: 0–90):
    // Pitch is the up-down tilt of the head (like nodding "yes").
    // If |pitch| ≤ this value, the user is considered to be facing the screen.
    // 18° is tighter than yaw because a large downward tilt usually means the
    // user is reading something in their lap, which is a stronger privacy risk.
    PITCH_SCREEN_THRESHOLD_DEG: 18.0,

    // EAR_BLINK_THRESHOLD (dimensionless ratio, range: 0.0–~0.4):
    // Eye Aspect Ratio (EAR) formula: (p2–p6 + p3–p5) / (2 × (p1–p4))
    //   where p1–p6 are the six landmark points around each eye.
    // When eyes are open, EAR ≈ 0.25–0.35.
    // When eyes are closed/blinking, EAR drops to ≈ 0.0–0.18.
    // Any frame where EAR < this threshold is flagged as "eyes closed",
    // which prevents the system from mistakenly reading gaze direction when
    // the user is blinking or has their eyes shut.
    EAR_BLINK_THRESHOLD: 0.18,

    // IRIS_RATIO_MIN / IRIS_RATIO_MAX (dimensionless ratio, range: 0.0–1.0):
    // Horizontal Iris Ratio measures the iris centre position within the eye
    // fissure (the gap between the inner and outer eye corners).
    //   0.0 = iris at the extreme inner corner (looking hard left/right inward)
    //   1.0 = iris at the extreme outer corner (looking hard left/right outward)
    //   0.5 = iris perfectly centred (looking straight ahead)
    // A ratio inside [IRIS_RATIO_MIN, IRIS_RATIO_MAX] means the user's gaze
    // is directed roughly at the screen rather than far to the side.
    // The window [0.35, 0.65] allows ±15 % deviation from centre.
    IRIS_RATIO_MIN: 0.35,
    IRIS_RATIO_MAX: 0.65,

    // STATES: Named string constants for all possible gaze outcomes.
    // Using constants (rather than raw strings like 'looking') prevents silent
    // typo bugs when other modules compare gaze state values.
    STATES: {
      LOOKING_AT_SCREEN: 'LOOKING_AT_SCREEN', // Head and eyes oriented toward the monitor
      LOOKING_AWAY: 'LOOKING_AWAY',           // Head turned or eyes diverted away from screen
      UNCERTAIN: 'UNCERTAIN'                  // Not enough landmark data to make a decision
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SECURITY DECISION ENGINE & ANTI-FLICKER LOGIC  (Member 2)
  // The security engine receives per-frame gaze/recognition results and must
  // convert them into stable, human-meaningful security states without
  // "flickering" between states on every minor detection fluctuation.
  // ─────────────────────────────────────────────────────────────────────────
  SECURITY: {
    // FRAME_CONFIRMATION_COUNT (integer, unit: frames):
    // The system does NOT trigger a PRIVACY_ALERT on the very first suspicious
    // frame. Instead it requires this many consecutive suspicious frames before
    // escalating. This filters out brief, innocent glances away from the screen
    // (e.g., reaching for a coffee cup) that are not genuine privacy threats.
    // At INFERENCE_INTERVAL_MS = 110 ms, 4 frames ≈ 440 ms of sustained suspicion.
    FRAME_CONFIRMATION_COUNT: 4,

    // RECOVERY_DELAY_MS (milliseconds):
    // Once a PRIVACY_ALERT is triggered, the system waits this long after
    // the threat clears (safe conditions return) before removing the privacy
    // blur. This prevents rapid blur-on / blur-off flicker when a user moves
    // their head back and forth near the alert threshold.
    // 2400 ms = 2.4 seconds of uninterrupted safe state to recover.
    RECOVERY_DELAY_MS: 2400,

    // NO_USER_TIMEOUT_MS (milliseconds):
    // If no face is detected for this duration, the system transitions to the
    // NO_USER_DETECTED state (screen is unattended).  2800 ms avoids false
    // alarms when a user briefly looks down at their keyboard.
    NO_USER_TIMEOUT_MS: 2800,

    // INFERENCE_INTERVAL_MS (milliseconds):
    // The main detection loop runs once every this many milliseconds rather than
    // on every animation frame (~16 ms at 60 fps). Running inference at ~9 fps
    // (110 ms interval) is fast enough for a smooth security response while
    // keeping the CPU cool and the UI responsive on a typical student laptop.
    INFERENCE_INTERVAL_MS: 110,

    // MAX_EVENT_LOG_ENTRIES (integer):
    // The on-screen event log is capped at this many entries to prevent the
    // log panel from growing unboundedly and consuming DOM memory.
    // Oldest entries are removed when the cap is exceeded (FIFO).
    MAX_EVENT_LOG_ENTRIES: 60,

    // STATES: Named string constants for all possible system security states.
    // The UI module uses these same strings to decide which CSS class and
    // message to display, so they must stay in sync with the HTML/CSS.
    STATES: {
      SAFE: 'SAFE',                       // Authorized user, looking at screen — all clear
      CAUTION: 'CAUTION',                 // Authorized user but gaze uncertainty is building up
      PRIVACY_ALERT: 'PRIVACY_ALERT',     // Threat confirmed — privacy blur is now active
      NO_USER_DETECTED: 'NO_USER_DETECTED', // No face visible for more than NO_USER_TIMEOUT_MS
      INITIALIZING: 'INITIALIZING',       // System is still loading models or starting the camera
      CAMERA_ERROR: 'CAMERA_ERROR',       // Camera failed to open or permission was denied
      MODEL_ERROR: 'MODEL_ERROR'          // Neural-network weight files failed to load
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CAMERA SETTINGS  (Member 3)
  // These values are passed to navigator.mediaDevices.getUserMedia() as the
  // "ideal" (preferred) constraints. The browser selects the closest supported
  // mode if the exact values are not available on the hardware.
  // ─────────────────────────────────────────────────────────────────────────
  CAMERA: {
    // DEFAULT_WIDTH (pixels): Preferred horizontal resolution of the webcam feed.
    // 640 px is the standard VGA width — widely supported, low bandwidth,
    // and large enough for reliable face landmark detection at close range.
    DEFAULT_WIDTH: 640,

    // DEFAULT_HEIGHT (pixels): Preferred vertical resolution.
    // 480 px pairs with 640 px to give the classic 4:3 VGA aspect ratio.
    DEFAULT_HEIGHT: 480,

    // FACING_MODE (string): Which camera to request on devices with multiple cameras.
    //   'user'        = front-facing (selfie) camera — correct for a laptop webcam.
    //   'environment' = rear camera (typically used for phone QR scanners).
    FACING_MODE: 'user',

    // FRAME_RATE (object): Preferred frames-per-second for the webcam stream.
    //   ideal: 30 — the browser targets 30 fps.
    //   max:   30 — the browser will not exceed 30 fps even if capable,
    //              preventing unnecessary CPU load from a 60 fps stream when
    //              the inference loop only runs at ~9 fps anyway.
    FRAME_RATE: { ideal: 30, max: 30 }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVACY SHIELD DISPLAY  (Member 3)
  // Visual settings for the canvas overlay and the privacy blur effect.
  // All colours follow CSS colour notation; all sizes are CSS length strings.
  // ─────────────────────────────────────────────────────────────────────────
  UI: {
    // BLUR_INTENSITY (CSS length string): The blur radius applied by the CSS
    // backdrop-filter when the privacy shield is active. 20px provides strong
    // enough blur to make screen content completely illegible to a bystander
    // while still being visually recognisable as a "blurred screen" effect.
    BLUR_INTENSITY: '20px',

    // AUTO_SCROLL_LOG (boolean): If true, the event log panel automatically
    // scrolls to the bottom whenever a new entry is added, so the user always
    // sees the most recent event without manually scrolling.
    AUTO_SCROLL_LOG: true,

    // CANVAS_COLORS: Colour constants used to draw bounding boxes and overlays
    // on the canvas that sits on top of the video feed. Each colour is chosen
    // for maximum visibility against typical office/room backgrounds.
    CANVAS_COLORS: {
      // Cyan bounding box: drawn around the face of a confirmed authorised user.
      // Cyan is a calm "all-clear" colour associated with approval/trust.
      AUTHORIZED: '#00e5ff',

      // Bright red: drawn when an unauthorised person triggers a PRIVACY_ALERT.
      // Red universally signals danger / stop — immediately recognisable.
      UNAUTHORIZED_ALERT: '#ff1744',

      // Amber/Orange: drawn for an unauthorised person who has not yet reached
      // the alert threshold. Orange signals caution without full alarm.
      UNAUTHORIZED_SAFE: '#ff9100',

      // Yellow: drawn for a face whose identity is uncertain (embedding distance
      // is in the borderline zone between MATCH_THRESHOLD and UNCERTAIN_THRESHOLD).
      UNKNOWN_UNCERTAIN: '#ffd600',

      // Semi-transparent cyan: used for the 68 facial landmark dots overlaid
      // on the face. Alpha = 0.45 keeps them visible without obscuring the face.
      LANDMARKS: 'rgba(0, 229, 255, 0.45)',

      // Bright yellow: used for the gaze direction vector line drawn from the
      // nose tip outward. Yellow stands out clearly against the blue landmarks.
      GAZE_VECTOR: '#ffea00'
    }
  }
});
