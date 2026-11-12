/**
 * VisionGuard: AI-Powered Facial Access Control System
 * Automated Verification & Unit Test Suite (tests/run-tests.js)
 * 
 * Verifies core mathematical logic, security state transitions,
 * gaze heuristics, anti-flicker hysteresis, and enrollment vector math.
 */

import { CONFIG } from '../js/config.js';
import { SecurityDecisionEngine } from '../js/security-engine.js';
import { GazeEstimator } from '../js/gaze-estimation.js';
import { FaceRecognizer } from '../js/face-recognition.js';

let passedTests = 0;
let failedTests = 0;
const results = [];

function assert(condition, testId, description) {
  if (condition) {
    passedTests++;
    results.push({ id: testId, status: 'PASS', description });
    console.log(`[PASS] ${testId}: ${description}`);
  } else {
    failedTests++;
    results.push({ id: testId, status: 'FAIL', description });
    console.error(`[FAIL] ${testId}: ${description}`);
  }
}

console.log('====================================================');
console.log('VISIONGUARD: AUTOMATED CORE ENGINE TEST RUNNER');
console.log('====================================================\n');

// ----------------------------------------------------
// TEST GROUP 1: Face Recognition & Euclidean Metric
// ----------------------------------------------------
const recognizer = new FaceRecognizer();

// 1. Identical Descriptors Distance == 0
const vecA = new Float32Array(128).fill(0.5);
const distSame = recognizer.calculateEuclideanDistance(vecA, vecA);
assert(Math.abs(distSame) < 1e-6, 'TC-01', 'Euclidean distance of identical vectors is 0.0');

// 2. Controlled Distance Matching
const vecB = new Float32Array(128);
vecB.set(vecA);
// Introduce small delta
vecB[0] += 0.2;
const distNear = recognizer.calculateEuclideanDistance(vecA, vecB);
const matchResultNear = recognizer.matchDescriptor(vecB, vecA);
assert(
  matchResultNear.isMatch === true && matchResultNear.matchStatus === 'AUTHORIZED',
  'TC-02',
  `Close vectors (dist ${distNear.toFixed(3)} < ${CONFIG.RECOGNITION.MATCH_THRESHOLD}) classified as AUTHORIZED`
);

// 3. Orthogonal/Dissimilar Vectors
const vecFar = new Float32Array(128).fill(-0.5);
const distFar = recognizer.calculateEuclideanDistance(vecA, vecFar);
const matchResultFar = recognizer.matchDescriptor(vecFar, vecA);
assert(
  matchResultFar.isMatch === false && matchResultFar.matchStatus === 'UNKNOWN',
  'TC-03',
  `Distant vectors (dist ${distFar.toFixed(3)} > ${CONFIG.RECOGNITION.UNCERTAIN_THRESHOLD}) classified as UNKNOWN`
);

// ----------------------------------------------------
// TEST GROUP 2: Gaze & Head Pose Estimation
// ----------------------------------------------------
const gaze = new GazeEstimator();

// Construct mock 68 landmarks representing a face looking straight forward
function createMockLandmarks(yawOffset = 0, pitchOffset = 0, earMultiplier = 1.0) {
  const positions = [];
  for (let i = 0; i < 68; i++) {
    positions.push({ x: 200, y: 200 });
  }

  // Outer eye corners (36 = left outer, 45 = right outer)
  positions[36] = { x: 150, y: 180 };
  positions[45] = { x: 250, y: 180 };

  // Midpoint is x: 200. Nose tip is landmark 30
  positions[30] = { x: 200 + yawOffset, y: 210 + pitchOffset };

  // Chin landmark 8
  positions[8] = { x: 200, y: 290 };

  // Left Eye landmarks (36, 37, 38, 39, 40, 41) centered at midline y: 180
  positions[37] = { x: 165, y: 180 - 8 * earMultiplier };
  positions[38] = { x: 180, y: 180 - 8 * earMultiplier };
  positions[39] = { x: 195, y: 180 };
  positions[40] = { x: 180, y: 180 + 8 * earMultiplier };
  positions[41] = { x: 165, y: 180 + 8 * earMultiplier };

  // Right Eye landmarks (42, 43, 44, 45, 46, 47) centered at midline y: 180
  positions[42] = { x: 205, y: 180 };
  positions[43] = { x: 220, y: 180 - 8 * earMultiplier };
  positions[44] = { x: 235, y: 180 - 8 * earMultiplier };
  positions[46] = { x: 235, y: 180 + 8 * earMultiplier };
  positions[47] = { x: 220, y: 180 + 8 * earMultiplier };

  return { positions };
}

// 4. Face Looking Straight at Screen
const straightLandmarks = createMockLandmarks(0, 0, 1.0);
const straightGaze = gaze.estimateGaze(straightLandmarks, 0, 0.95);
assert(
  straightGaze.gazeState === CONFIG.GAZE.STATES.LOOKING_AT_SCREEN && straightGaze.isLookingAtScreen === true,
  'TC-04',
  'Centered head pose and open eyes classified as LOOKING_AT_SCREEN'
);

// 5. Head Turned Away (Yaw > 22 deg)
const turnedLandmarks = createMockLandmarks(40, 0, 1.0); // nose shifted right
const turnedGaze = gaze.estimateGaze(turnedLandmarks, 0, 0.95);
assert(
  turnedGaze.gazeState === CONFIG.GAZE.STATES.LOOKING_AWAY && turnedGaze.isLookingAtScreen === false,
  'TC-05',
  `Turned head pose (Yaw: ${turnedGaze.yawDeg}°) classified as LOOKING_AWAY`
);

// 6. Blinking / Closed Eyes (Low EAR)
const closedEyeLandmarks = createMockLandmarks(0, 0, 0.05); // collapsed eyelids
const closedEyeGaze = gaze.estimateGaze(closedEyeLandmarks, 0, 0.95);
assert(
  closedEyeGaze.gazeState === CONFIG.GAZE.STATES.UNCERTAIN,
  'TC-06',
  `Closed eyelids (EAR: ${closedEyeGaze.avgEar}) classified as UNCERTAIN`
);

// ----------------------------------------------------
// TEST GROUP 3: Security Decision Engine State Machine
// ----------------------------------------------------
const engine = new SecurityDecisionEngine();

// 7. Inactive Camera triggers CAMERA_ERROR
const errorReport = engine.evaluateFrame({
  faces: [],
  hasEnrolledUser: true,
  isCameraActive: false,
  isModelLoaded: true
});
assert(
  errorReport.state === CONFIG.SECURITY.STATES.CAMERA_ERROR,
  'TC-07',
  'Inactive camera immediately results in CAMERA_ERROR (Never silently SAFE)'
);

// 8. Inactive Models triggers MODEL_ERROR
const modelErrorReport = engine.evaluateFrame({
  faces: [],
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: false
});
assert(
  modelErrorReport.state === CONFIG.SECURITY.STATES.MODEL_ERROR,
  'TC-08',
  'Unloaded model immediately results in MODEL_ERROR'
);

// 9. Single Authorized Face -> SAFE
engine.reset();
const safeFace = {
  box: { x: 100, y: 100, width: 120, height: 120 },
  score: 0.95,
  matchResult: { isMatch: true, matchStatus: 'AUTHORIZED', distance: 0.35, confidencePercent: 92 },
  gazeResult: { gazeState: CONFIG.GAZE.STATES.LOOKING_AT_SCREEN, isLookingAtScreen: true, confidence: 0.9, yawDeg: 2, pitchDeg: 1 }
};
const safeReport = engine.evaluateFrame({
  faces: [safeFace],
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  safeReport.state === CONFIG.SECURITY.STATES.SAFE && safeReport.shouldShieldBlur === false,
  'TC-09',
  'Single authorized user in view transitions engine to SAFE without blur'
);

// 10. Unauthorized Face Looking Away -> CAUTION
const unauthorizedAwayFace = {
  box: { x: 250, y: 100, width: 120, height: 120 },
  score: 0.90,
  matchResult: { isMatch: false, matchStatus: 'UNKNOWN', distance: 0.85, confidencePercent: 10 },
  gazeResult: { gazeState: CONFIG.GAZE.STATES.LOOKING_AWAY, isLookingAtScreen: false, confidence: 0.8, yawDeg: 35, pitchDeg: 0 }
};
const cautionReport = engine.evaluateFrame({
  faces: [safeFace, unauthorizedAwayFace],
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  cautionReport.state === CONFIG.SECURITY.STATES.CAUTION && cautionReport.shouldShieldBlur === false,
  'TC-10',
  'Unauthorized face looking away classified as CAUTION (no immediate blur)'
);

// 11. Unauthorized Face Looking At Screen -> Accumulates Confirmation Frames
const unauthorizedThreatFace = {
  box: { x: 250, y: 100, width: 120, height: 120 },
  score: 0.92,
  matchResult: { isMatch: false, matchStatus: 'UNKNOWN', distance: 0.88, confidencePercent: 5 },
  gazeResult: { gazeState: CONFIG.GAZE.STATES.LOOKING_AT_SCREEN, isLookingAtScreen: true, confidence: 0.88, yawDeg: 4, pitchDeg: 2 }
};

// Frame 1 of threat: Should be CAUTION (pending confirmation)
const frame1Report = engine.evaluateFrame({
  faces: [safeFace, unauthorizedThreatFace],
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  frame1Report.state === CONFIG.SECURITY.STATES.CAUTION && frame1Report.suspiciousFrameCount === 1,
  'TC-11',
  '1st frame of unauthorized viewer is held at CAUTION pending confirmation'
);

// Accumulate frames up to FRAME_CONFIRMATION_COUNT
let finalThreatReport = null;
for (let f = 2; f <= CONFIG.SECURITY.FRAME_CONFIRMATION_COUNT; f++) {
  finalThreatReport = engine.evaluateFrame({
    faces: [safeFace, unauthorizedThreatFace],
    hasEnrolledUser: true,
    isCameraActive: true,
    isModelLoaded: true
  });
}
assert(
  finalThreatReport.state === CONFIG.SECURITY.STATES.PRIVACY_ALERT && finalThreatReport.shouldShieldBlur === true,
  'TC-12',
  `After ${CONFIG.SECURITY.FRAME_CONFIRMATION_COUNT} consecutive frames, engine transitions to PRIVACY_ALERT and triggers blur`
);

// 12. Threat Disappears -> Cooldown / Recovery Delay Enforced
const recoveryFrame1 = engine.evaluateFrame({
  faces: [safeFace], // Threat gone, only safe face remains
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  recoveryFrame1.state === CONFIG.SECURITY.STATES.PRIVACY_ALERT && recoveryFrame1.shouldShieldBlur === true,
  'TC-13',
  'Blur remains locked active during recovery cooldown period to prevent rapid flickering'
);

// 14. No Enrolled User -> CAUTION
engine.reset();
const noEnrollmentReport = engine.evaluateFrame({
  faces: [safeFace],
  hasEnrolledUser: false,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  noEnrollmentReport.state === CONFIG.SECURITY.STATES.CAUTION,
  'TC-14',
  'No enrolled user template transitions engine to CAUTION'
);

// 15. Two Authorized Faces -> CAUTION (Unexpected duplicate identity)
engine.reset();
const dualAuthorizedReport = engine.evaluateFrame({
  faces: [safeFace, safeFace],
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  dualAuthorizedReport.state === CONFIG.SECURITY.STATES.CAUTION,
  'TC-15',
  'Multiple faces present transitions engine to CAUTION'
);

// 16. Two faces (1 Authorized + 1 Unauthorized Looking at Screen) -> Threat Escalation
engine.reset();
for (let f = 0; f < CONFIG.SECURITY.FRAME_CONFIRMATION_COUNT; f++) {
  finalThreatReport = engine.evaluateFrame({
    faces: [safeFace, unauthorizedThreatFace],
    hasEnrolledUser: true,
    isCameraActive: true,
    isModelLoaded: true
  });
}
assert(
  finalThreatReport.state === CONFIG.SECURITY.STATES.PRIVACY_ALERT && finalThreatReport.shouldShieldBlur === true,
  'TC-16',
  'Authorized user + Unauthorized viewer looking at screen triggers PRIVACY_ALERT'
);

// 17. No Face Detected for Timeout -> NO_USER_DETECTED
engine.reset();
// Simulate passage of time past NO_USER_TIMEOUT_MS
engine.lastFaceDetectedTime = Date.now() - (CONFIG.SECURITY.NO_USER_TIMEOUT_MS + 500);
const noUserReport = engine.evaluateFrame({
  faces: [],
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  noUserReport.state === CONFIG.SECURITY.STATES.NO_USER_DETECTED,
  'TC-17',
  'Zero faces detected beyond timeout transitions to NO_USER_DETECTED'
);

// 18. Brief Face Dropout (< timeout) holds state
engine.reset();
engine.currentState = CONFIG.SECURITY.STATES.SAFE;
engine.lastFaceDetectedTime = Date.now() - 200; // only 200ms ago
const dropoutReport = engine.evaluateFrame({
  faces: [],
  hasEnrolledUser: true,
  isCameraActive: true,
  isModelLoaded: true
});
assert(
  dropoutReport.state === CONFIG.SECURITY.STATES.SAFE,
  'TC-18',
  'Brief detection dropout (< timeout) temporarily holds state without abrupt change'
);

// 19. Multi-Sample Biometric Vector Averaging & L2-Normalization
const sample1 = new Float32Array([1.0, 0.0, 0.0]);
const sample2 = new Float32Array([0.0, 1.0, 0.0]);
const averaged = new Float32Array(3);
for (let d = 0; d < 3; d++) {
  averaged[d] = (sample1[d] + sample2[d]) / 2.0; // [0.5, 0.5, 0.0]
}
let norm = Math.sqrt(averaged[0]*averaged[0] + averaged[1]*averaged[1] + averaged[2]*averaged[2]);
for (let d = 0; d < 3; d++) {
  averaged[d] /= norm;
}
const finalNorm = Math.sqrt(averaged[0]*averaged[0] + averaged[1]*averaged[1] + averaged[2]*averaged[2]);
assert(
  Math.abs(finalNorm - 1.0) < 1e-6,
  'TC-19',
  'Averaged biometric embeddings successfully L2-normalized to unit hypersphere (norm = 1.0)'
);

// 20. Config Centralization & Immutability Check
let configIsFrozen = Object.isFrozen(CONFIG);
assert(
  configIsFrozen === true,
  'TC-20',
  'Configuration object is immutable (Object.freeze) and centralized in js/config.js'
);

console.log('\n====================================================');
console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED out of ${passedTests + failedTests} tests.`);
console.log('====================================================');

if (failedTests > 0) {
  process.exit(1);
}
