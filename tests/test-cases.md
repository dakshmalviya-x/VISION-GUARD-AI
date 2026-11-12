# VisionGuard: Detailed Test Matrix & Execution Evidence

| Test ID | Category | Description | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| **TC-01** | Recognition Math | Euclidean metric of identical descriptors | 128-d vector initialized | Compute distance between $\vec{v}$ and $\vec{v}$ | Distance == 0.000 | Distance = 0.000 | **PASS** |
| **TC-02** | Recognition Math | Identity match within tolerance ($d < 0.52$) | Enrolled template in memory | Test vector with small delta ($d=0.20$) | Classified as `AUTHORIZED`, similarity > 60% | `AUTHORIZED` (similarity 69%), isMatch=true | **PASS** |
| **TC-03** | Recognition Math | Identity mismatch ($d > 0.64$) | Enrolled template in memory | Test vector with large delta ($d=11.31$) | Classified as `UNKNOWN`, similarity = 0% | `UNKNOWN` (similarity 0%), isMatch=false | **PASS** |
| **TC-04** | Gaze Heuristic | Direct gaze toward monitor | 68 landmarks with centered nose & eye corners | Call `estimateGaze()` | `LOOKING_AT_SCREEN`, isLookingAtScreen=true | `LOOKING_AT_SCREEN`, Yaw: 0°, Pitch: 0° | **PASS** |
| **TC-05** | Gaze Heuristic | Head rotated away ($\|yaw\| > 22^\circ$) | 68 landmarks with nose shifted 40px right | Call `estimateGaze()` | `LOOKING_AWAY`, isLookingAtScreen=false | `LOOKING_AWAY`, Yaw: 34.0° | **PASS** |
| **TC-06** | Gaze Heuristic | Eye blink / eyelid closure ($EAR < 0.18$) | 68 landmarks with collapsed eyelids | Call `estimateGaze()` | `UNCERTAIN` state due to closed eyes | `UNCERTAIN` (EAR: 0.018 < 0.18) | **PASS** |
| **TC-07** | Invariant Safety | Inactive camera stream detection | Camera stream = null / stopped | Evaluate frame in engine | Engine transitions to `CAMERA_ERROR` | `CAMERA_ERROR`, threatLevel: CRITICAL | **PASS** |
| **TC-08** | Invariant Safety | Missing/unloaded AI models | Model loaded flag = false | Evaluate frame in engine | Engine transitions to `MODEL_ERROR` | `MODEL_ERROR`, threatLevel: CRITICAL | **PASS** |
| **TC-09** | Security Logic | Solitary authorized user in view | 1 face, $d < 0.52$, looking at screen | Evaluate frame in engine | Engine transitions to `SAFE`, no blur | `SAFE`, shouldShieldBlur=false | **PASS** |
| **TC-10** | Security Logic | Unauthorized person looking away | 1 authorized + 1 unknown (looking away) | Evaluate frame in engine | Engine transitions to `CAUTION`, no blur | `CAUTION`, shouldShieldBlur=false | **PASS** |
| **TC-11** | Temporal Filter | 1st frame of unauthorized viewer | 1 authorized + 1 unknown looking at screen | Evaluate 1st suspicious frame | Held at `CAUTION`, frame count = 1 | `CAUTION` (Pending confirmation), frame=1 | **PASS** |
| **TC-12** | Temporal Filter | Sustained unauthorized viewer | Threat held for 4 frames ($N \ge 4$) | Evaluate frame 4 | Engine transitions to `PRIVACY_ALERT`, blur active | `PRIVACY_ALERT`, shouldShieldBlur=true | **PASS** |
| **TC-13** | Anti-Flicker | Recovery delay hysteresis | Threat leaves immediately | Evaluate frame during 2.4s cooldown | Privacy shield remains locked active | Shield locked active, remaining: ~2.4s | **PASS** |
| **TC-14** | Security Logic | No enrolled user template | Clean localStorage, 1 face in view | Evaluate frame in engine | Engine warns with `CAUTION` (unverified identity) | `CAUTION`, prompt to enroll user | **PASS** |
| **TC-15** | Security Logic | Multiple authorized faces (duplicate) | 2 faces matching authorized vector | Evaluate frame in engine | Engine transitions to `CAUTION` | `CAUTION` (Multiple faces detected) | **PASS** |
| **TC-16** | Security Logic | Primary user + unauthorized viewer | 1 authorized user + 1 unauthorized | Feed 4 frames with threat gazing at screen | Transitions to `PRIVACY_ALERT` | `PRIVACY_ALERT`, blur triggered | **PASS** |
| **TC-17** | Timeout Logic | Solitary user leaves webcam view | 0 faces for $> 2.8$ seconds | Evaluate frame past timeout | Engine transitions to `NO_USER_DETECTED` | `NO_USER_DETECTED`, threatLevel: LOW | **PASS** |
| **TC-18** | Jitter Tolerance | Brief detection dropout ($< 2.8$s) | 0 faces for 200 milliseconds | Evaluate frame before timeout | Engine holds prior state without sudden flicker | Holds `SAFE` state without interruption | **PASS** |
| **TC-19** | Biometric Math | L2-normalization of averaged vector | 2 random embedding sample vectors | Average vectors and compute L2 norm | Normalized vector length $\|v\| = 1.000$ | $\|v\| = 1.000000$ | **PASS** |
| **TC-20** | Architecture | Configuration immutability | Central `CONFIG` object in `config.js` | Check `Object.isFrozen(CONFIG)` | True, immutable settings | `Object.isFrozen(CONFIG) === true` | **PASS** |

---

## 4. Summary of Verification Results

- **Total Test Cases Executed**: 20
- **Total Passed**: 20 (100%)
- **Total Failed**: 0 (0%)
- **Verification Environment**: Automated Node.js runner (`tests/run-tests.js`) and Browser Automation (`http://localhost:8080`).
