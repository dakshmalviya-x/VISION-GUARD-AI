/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Camera Management Module (js/camera.js)
 *
 * Maintained primarily by Member 3 (Frontend, Privacy Shield, and Integration)
 *
 * Manages webcam lifecycle via navigator.mediaDevices.getUserMedia, handles
 * resolution scaling, cleans up hardware resources on stop, and translates
 * browser permission/hardware errors into user-friendly diagnostics.
 *
 * WHY a dedicated class?
 *   Wrapping the browser camera API in a class lets every other module call
 *   cameraManager.start() / cameraManager.stop() without knowing the low-level
 *   getUserMedia details. It also centralises error handling in one place.
 */

// Pull in the central config object so camera resolution/frame-rate settings
// are not hard-coded here — they live in config.js and are shared app-wide.
import { CONFIG } from './config.js';

export class CameraManager {
  /**
   * Sets up initial state. No hardware is touched until start() is called.
   * Keeping the constructor side-effect-free means creating a CameraManager
   * instance is always safe — it won't prompt for permissions yet.
   */
  constructor() {
    // The raw MediaStream object returned by getUserMedia (holds video tracks).
    // null means no stream is currently open.
    this.stream = null;

    // Reference to the <video> element whose srcObject will display the feed.
    this.videoElement = null;

    // Simple boolean flag so other modules can quickly ask "is the camera on?"
    this.isRunning = false;

    // The first (and usually only) video track extracted from the stream.
    // Keeping a direct reference lets us call track.getSettings() to read the
    // actual negotiated resolution from the hardware driver.
    this.activeTrack = null;

    // The actual resolution the camera is streaming at after negotiation.
    // Starts at zero because nothing is streaming yet.
    this.currentResolution = { width: 0, height: 0 };
  }

  /**
   * Check if the current browser environment supports webcam access.
   *
   * WHY a static method?
   *   This check doesn't depend on any instance state — it's a capability
   *   test for the browser itself. Making it static lets callers run it
   *   before even constructing a CameraManager instance.
   *
   * Note: Browsers mandate HTTPS or localhost for getUserMedia because
   *   microphone/camera access over plain HTTP would be a serious security
   *   risk (a man-in-the-middle attacker could intercept the feed).
   *
   * @returns {boolean} true if getUserMedia is available in this browser
   */
  static isSupported() {
    return !!(
      // navigator.mediaDevices exists in modern browsers (Chrome 47+, Firefox 44+).
      // It is undefined in very old browsers and also in HTTP (non-secure) contexts.
      navigator.mediaDevices &&
      // Double-check that getUserMedia is a callable function, not just a property
      // that exists but has been shimmed as a no-op in some legacy environments.
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  /**
   * Request webcam access and attach the resulting MediaStream to a video element.
   *
   * Flow:
   *   1. Validate inputs and check browser support.
   *   2. Build a "constraints" object describing the desired video format.
   *   3. Ask the browser for the stream (shows permission prompt to user).
   *   4. Attach the stream to the <video> element and wait for metadata to load.
   *   5. Begin playback, read actual resolution from the hardware driver.
   *   6. If anything fails, clean up and throw a translated (human-readable) error.
   *
   * @param {HTMLVideoElement} videoElement - Target HTML5 video element for rendering feed
   * @returns {Promise<{ width: number, height: number }>} - Active feed resolution after negotiation
   */
  async start(videoElement) {
    // Guard: a video element is required — without it there is nowhere to render.
    if (!videoElement) {
      throw new Error('CameraManager.start: A valid HTMLVideoElement must be provided.');
    }

    // Guard: bail out early with a friendly message if the browser can't do cameras.
    // The alternative would be a cryptic "navigator.mediaDevices is not defined" crash.
    if (!CameraManager.isSupported()) {
      throw new Error(
        'Webcam access is not supported in this browser. Please ensure you are running on localhost or over HTTPS in a modern browser (Chrome, Firefox, Edge).'
      );
    }

    // If the camera is already streaming to exactly this video element,
    // return the cached resolution immediately — no need to restart hardware.
    if (this.isRunning && this.stream && this.videoElement === videoElement) {
      return this.currentResolution;
    }

    // Always stop any previously-active stream before requesting a new one.
    // Without this, the old stream keeps the hardware locked and the new
    // getUserMedia call may throw a NotReadableError / TrackStartError.
    this.stop();

    // Build the MediaStreamConstraints object that tells the browser what we want.
    // Using "ideal" values (rather than "exact") means the browser will get as
    // close as it can; if 640×480 isn't available it will pick the next-best mode
    // rather than throwing an OverconstrainedError.
    const constraints = {
      audio: false, // VisionGuard never needs audio — disabling it improves privacy
      video: {
        width: { ideal: CONFIG.CAMERA.DEFAULT_WIDTH },   // Prefer 640 px wide
        height: { ideal: CONFIG.CAMERA.DEFAULT_HEIGHT }, // Prefer 480 px tall
        facingMode: CONFIG.CAMERA.FACING_MODE,           // 'user' = front-facing camera
        frameRate: CONFIG.CAMERA.FRAME_RATE              // { ideal: 30, max: 30 }
      }
    };

    try {
      // This is the actual browser API call that shows the permission prompt.
      // It resolves with a MediaStream object if the user grants access,
      // or rejects with a DOMException if they deny or hardware is unavailable.
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Store a reference to the video element so we can detach it in stop().
      this.videoElement = videoElement;

      // Attach the live stream to the <video> element. This tells the browser
      // to route the camera feed frames into this element's renderer.
      this.videoElement.srcObject = this.stream;

      // playsInline = true: Required on iOS Safari to prevent full-screen hijacking.
      // Without this, the feed would launch in a full-screen player on iPhones/iPads.
      this.videoElement.playsInline = true;

      // muted = true: The stream has no audio track (we set audio:false above),
      // but some browsers still require the video element to be muted before
      // they allow autoplay (browsers block auto-playing media with sound).
      this.videoElement.muted = true;

      // Wait for the browser to load video metadata (resolution, duration, etc.)
      // before continuing. We need videoWidth / videoHeight to be non-zero.
      // readyState < 1 means HAVE_NOTHING — metadata hasn't arrived yet.
      if (this.videoElement.readyState < 1) {
        await new Promise((resolve, reject) => {
          // Safety timeout: if the camera driver takes more than 8 seconds to
          // report any metadata, something has gone wrong (driver crash, bad USB
          // connection). We resolve early if videoWidth appeared despite readyState
          // lagging, otherwise we reject with a clear timeout message.
          const timeout = setTimeout(() => {
            if (this.videoElement.videoWidth > 0 || this.videoElement.readyState >= 1) {
              // Dimensions arrived via a different code path — we can continue safely.
              resolve();
            } else {
              reject(new Error('Camera stream timed out while loading video metadata.'));
            }
          }, 8000); // 8-second timeout; covers slow USB cameras and virtual cam drivers

          // The normal path: browser fires "loadedmetadata" once it knows the
          // stream's resolution and other properties. Clear the safety timeout
          // so we don't get a spurious rejection after a successful load.
          this.videoElement.onloadedmetadata = () => {
            clearTimeout(timeout);
            resolve();
          };

          // If the video element itself emits an error (e.g. codec unsupported),
          // reject immediately with that error so it can be translated below.
          this.videoElement.onerror = (err) => {
            clearTimeout(timeout);
            reject(err);
          };
        });
      }

      // Start the video feed rendering. play() is async and must be awaited;
      // calling it synchronously and ignoring the promise can cause "play()
      // was interrupted" console errors in Chrome when the page is backgrounded.
      await this.videoElement.play();

      // Mark the manager as active so isActive() returns true from this point on.
      this.isRunning = true;

      // Read the actual negotiated resolution from the hardware driver.
      // getVideoTracks() returns the array of video tracks in the stream;
      // there is typically exactly one for a webcam.
      const tracks = this.stream.getVideoTracks();
      if (tracks.length > 0) {
        this.activeTrack = tracks[0]; // Keep a direct handle to the first video track

        // getSettings() returns the actual constraints the driver chose, including
        // the real width and height the camera is streaming at (may differ from
        // what we asked for if the hardware doesn't support 640×480 exactly).
        const settings = this.activeTrack.getSettings ? this.activeTrack.getSettings() : {};

        // Resolution priority: driver setting → video element dimension → config default.
        // We fall back along this chain in case getSettings() returns an empty object
        // (some older browsers don't implement it fully).
        this.currentResolution = {
          width: settings.width || this.videoElement.videoWidth || CONFIG.CAMERA.DEFAULT_WIDTH,
          height: settings.height || this.videoElement.videoHeight || CONFIG.CAMERA.DEFAULT_HEIGHT
        };
      } else {
        // Unusual case: stream exists but reports zero video tracks.
        // Fall back to what the video element itself reports.
        this.currentResolution = {
          width: this.videoElement.videoWidth,
          height: this.videoElement.videoHeight
        };
      }

      // Return the confirmed resolution so callers can size their canvas overlay.
      return this.currentResolution;

    } catch (err) {
      // Something went wrong. Release any partially-acquired hardware resources
      // so the camera light turns off and the hardware is not left locked.
      this.stop();

      // Convert the low-level DOMException into a beginner-friendly message
      // before re-throwing. Callers receive a meaningful string, not a cryptic
      // browser internal error name like "NotAllowedError".
      throw this.translateError(err);
    }
  }

  /**
   * Stop the active webcam stream, release hardware lock, and reset video element.
   *
   * WHY call track.stop() on each track individually?
   *   Simply setting srcObject = null pauses rendering but does NOT release the
   *   camera hardware. The camera indicator light would stay on and other apps
   *   (Zoom, Teams) would still be blocked from accessing the camera. Calling
   *   track.stop() sends the signal that terminates hardware capture.
   */
  stop() {
    if (this.stream) {
      // Iterate every track in the stream (audio + video, though we only have video).
      // Each track must be stopped individually — there is no "stop whole stream" API.
      this.stream.getTracks().forEach((track) => {
        try {
          track.stop(); // This releases the hardware and turns off the camera LED
        } catch (e) {
          // Stopping a track that is already stopped throws in some browsers.
          // This is harmless — log a warning and continue cleaning up.
          console.warn('CameraManager: Error stopping track', e);
        }
      });
      this.stream = null; // Drop the reference so GC can reclaim the MediaStream object
    }

    if (this.videoElement) {
      try {
        this.videoElement.pause();     // Halt frame rendering in the <video> element
        this.videoElement.srcObject = null; // Detach the stream — element shows blank/poster
      } catch (e) {
        // pause() can throw if the element is in a bad ready state (e.g., mid-seek).
        console.warn('CameraManager: Error detaching video element', e);
      }
      this.videoElement = null; // Release the DOM element reference
    }

    // Reset all instance state so the object is in the same condition as after
    // construction — a subsequent call to start() will work correctly.
    this.activeTrack = null;
    this.isRunning = false;
    this.currentResolution = { width: 0, height: 0 };
  }

  /**
   * Get active operational status.
   *
   * Checks BOTH the isRunning flag AND the stream object because there is a
   * brief window during error recovery when isRunning could be true while the
   * stream is being nulled out by stop(). Both must be truthy for "truly active".
   *
   * @returns {boolean} true if the camera stream is currently live
   */
  isActive() {
    return this.isRunning && !!this.stream;
  }

  /**
   * Get current video resolution.
   *
   * Returns a shallow copy (spread syntax) rather than the internal object
   * directly. This prevents callers from accidentally mutating
   * this.currentResolution, which would break the cached value.
   *
   * @returns {{ width: number, height: number }}
   */
  getResolution() {
    return { ...this.currentResolution };
  }

  /**
   * Maps DOMExceptions thrown by getUserMedia into clear, informative error
   * messages suitable for a student presentation or end-user display.
   *
   * WHY a separate method?
   *   Browser DOMException names like "NotAllowedError" or "NotReadableError"
   *   are meaningful to a web developer but completely opaque to a first-time
   *   user. Translating them here centralises that knowledge in one easy-to-read
   *   switch block.
   *
   * BROWSER DOMException reference:
   *   Each case below corresponds to a specific browser-thrown error name.
   *   The W3C MediaCapture spec defines these names; most browsers follow it.
   *
   * @param {DOMException|Error} err - The raw error thrown by getUserMedia
   * @returns {Error} A new Error with a human-readable message and extra properties
   */
  translateError(err) {
    const errorName = err.name || ''; // DOMException.name identifies the error type
    let userMessage = '';
    let category = 'CAMERA_ERROR'; // Maps to CONFIG.SECURITY.STATES.CAMERA_ERROR

    switch (errorName) {
      // ── Permission errors ─────────────────────────────────────────────────
      case 'NotAllowedError':
      // 'PermissionDeniedError' is the older (pre-spec) name used by Firefox ≤ 55
      // and some older Chromium versions. Both mean the user clicked "Block".
      case 'PermissionDeniedError':
        userMessage =
          'Camera permission was denied. Please click the camera icon in your browser address bar to grant access, then retry.';
        break;

      // ── Hardware not found errors ─────────────────────────────────────────
      case 'NotFoundError':
      // 'DevicesNotFoundError' is the legacy name in older Chrome / Opera builds.
      // Both mean the OS reported no suitable camera device at all.
      case 'DevicesNotFoundError':
        userMessage =
          'No camera was found on your system. Please connect a webcam or enable your laptop camera in Device Settings.';
        break;

      // ── Hardware locked by another application ────────────────────────────
      case 'NotReadableError':
      // 'TrackStartError' is the Firefox-specific equivalent name for the same
      // condition: the OS-level camera driver refused to open because another
      // process (Zoom, Teams, OBS, another browser tab) already holds the lock.
      case 'TrackStartError':
        userMessage =
          'Camera is already in use by another application (e.g. Zoom, Microsoft Teams, or another browser tab). Please close other apps and try again.';
        break;

      // ── Requested settings not supported ─────────────────────────────────
      case 'OverconstrainedError':
        // This fires when we used "exact" constraints (we use "ideal", so this
        // should be rare) or when the hardware simply cannot do what was asked
        // (e.g. a webcam that only supports 1080p when we requested 320×240).
        userMessage =
          'The requested camera resolution or frame rate is not supported by your hardware.';
        break;

      // ── HTTPS / security policy violation ────────────────────────────────
      case 'SecurityError':
        // The page was served over plain HTTP (not localhost and not HTTPS).
        // Modern browsers block camera access on insecure origins to prevent
        // man-in-the-middle attacks that could intercept the video stream.
        userMessage =
          'Camera access blocked by browser security policy. Make sure you access VisionGuard via http://localhost or HTTPS.';
        break;

      // ── Catch-all for any other unexpected DOMException ───────────────────
      default:
        // Fall back to whatever message the browser provides (may be technical)
        // combined with the error name so the developer has something to debug.
        userMessage = `Failed to access camera: ${err.message || errorName || 'Unknown camera error.'}`;
    }

    // Build a new Error object that carries the friendly message as its main
    // .message property (shown in alerts, console logs, and UI error panels).
    const customErr = new Error(userMessage);

    // Preserve the original DOMException.name so callers can still branch on
    // error type if they need to (e.g. to show different retry UX).
    customErr.name = errorName;

    // category matches CONFIG.SECURITY.STATES values so the security engine can
    // set the system state to CAMERA_ERROR without an additional string literal.
    customErr.category = category;

    // Attach the original error for debugging — a developer can inspect
    // customErr.originalError in the browser DevTools console for full details.
    customErr.originalError = err;

    return customErr;
  }
}
