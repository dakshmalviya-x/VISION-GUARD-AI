# VisionGuard Browser Extension

VisionGuard is a Manifest V3 browser extension that uses on-device face detection and recognition to detect shoulder surfing. When an unknown person appears to be looking at the screen, it blurs the current webpage and displays a warning. Camera frames and enrollment data stay on the device.

## Load the extension

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**, choose **Load unpacked**, and select the project folder containing `manifest.json`.
4. Open a regular webpage and select the VisionGuard toolbar icon.
5. Choose **Enable on This Tab** and allow camera access if prompted.
6. Choose **Enroll User** and follow the on-page capture instructions.

Use the popup to disable monitoring or reset the enrolled identity. Browser-internal pages, extension stores, and other restricted pages do not allow script injection.

## Extension architecture

The project root is the unpacked extension package; keep `manifest.json` at its root.

- `manifest.json` — Manifest V3 metadata, permissions, popup, and packaged resources.
- `popup.html`, `popup.css`, `popup.js` — toolbar controls and enrollment status.
- `background.js` — service worker that tracks active tabs and injects/removes the extension UI and scripts.
- `js/content-script.js` — isolated-world camera, inference, enrollment, and privacy-shield runtime.
- `shield.css` — injected styles for the camera widget, page blur, and warning overlay.
- `js/vendor/face-api.js`, `models/` — bundled inference library and model weights; no model CDN is required.
- `tests/` — Node.js checks for recognition, gaze, and security-decision logic.
- `docs/` — project and academic documentation.

`js/content-script.js` contains the extension's injected runtime. The `js/config.js`, `js/face-recognition.js`, `js/gaze-estimation.js`, and `js/security-engine.js` modules are retained only as testable reference implementations; the extension does not import these ES modules.

## Permissions and privacy

The extension requests storage access for local enrollment and tab/script access to enable monitoring on webpages chosen by the user. It captures camera video only while monitoring is enabled. Enrollment stores a numeric face descriptor in `chrome.storage.local`; it does not save or transmit video or photographs. The blur applies to webpage content only and cannot protect desktop applications or browser-internal pages.

## Run automated tests

Requires Node.js:

```bash
node tests/run-tests.js
```

## Documentation

- [System architecture](docs/architecture.md)
- [Complete project guide](docs/complete-project-guide.md)
- [Member contributions](docs/member-contributions.md)
- [Testing plan](tests/test-plan.md)
- [Troubleshooting](docs/troubleshooting.md)

The detailed academic guides are retained as project documentation and may describe the earlier standalone webpage prototype.
