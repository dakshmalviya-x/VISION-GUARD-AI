# VisionGuard Extension Architecture

VisionGuard is packaged and run as a Manifest V3 browser extension. The project root is the unpacked extension directory, and `manifest.json` is the package entry point. There is no standalone webpage or website deployment target.

## Runtime flow

```text
Toolbar popup
  ├─ Enable / Disable current tab
  ├─ Show enrolled identity
  └─ Start enrollment / reset identity
          │ chrome.runtime messages
          ▼
Manifest V3 service worker (background.js)
  ├─ Tracks active tab IDs in chrome.storage.session
  ├─ Injects shield.css
  ├─ Injects js/vendor/face-api.js into the isolated world
  └─ Injects js/content-script.js into the isolated world
          │
          ▼
Injected runtime (js/content-script.js)
  Camera → face detection / descriptor → gaze estimate
         → security state machine → page shield and warning
          │
          ├─ Models loaded from the packaged models/ directory
          └─ Enrollment descriptor stored in chrome.storage.local
```

## Package responsibilities

- `manifest.json` declares the popup, service worker, permissions, icons, and resources needed by the injected runtime.
- `popup.html`, `popup.css`, and `popup.js` provide controls in the browser toolbar. The popup asks the service worker to change the current tab state and reads enrollment status from local extension storage.
- `background.js` serializes active-tab state updates and injects or removes the runtime. It does not process camera frames.
- `js/content-script.js` runs in Chrome's isolated world. It creates the camera widget and shield overlay, loads the bundled models, performs inference, enrolls the authorized user, and releases camera/UI resources when disabled.
- `shield.css` styles only VisionGuard-owned elements and the page shield.
- `js/vendor/face-api.js` and `models/` are packaged locally so model inference does not depend on a CDN.

## Security and privacy boundaries

Monitoring starts only after the user enables VisionGuard for a tab. The browser prompts for camera access as needed. Video frames are processed locally and are not persisted; the enrollment record contains a numeric face descriptor in `chrome.storage.local`. Active tab IDs use session-scoped extension storage and do not persist across browser restarts.

The extension can affect webpage DOM content only. Browser-internal pages, extension stores, and other restricted pages do not allow injection. It cannot blur other tabs, desktop applications, or the operating system display.

## Reference modules and tests

`js/config.js`, `js/face-recognition.js`, `js/gaze-estimation.js`, and `js/security-engine.js` are retained as testable reference modules. The extension's injected script is a classic script and has its own runtime implementation; it does not import these ES modules. `tests/run-tests.js` runs Node.js checks against the reference recognition, gaze, and security-engine modules. Keep these modules distinct from the injected runtime unless the extension loading model is intentionally refactored and verified.
