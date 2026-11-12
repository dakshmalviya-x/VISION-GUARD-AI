/**
 * VisionGuard – Privacy Shield
 * popup.js — Controls the extension popup UI.
 *
 * This script runs in the popup's browser context (NOT in the page's context).
 * It communicates with:
 *   - background.js  via chrome.runtime.sendMessage()
 *   - content-script.js via chrome.tabs.sendMessage()
 * It reads/writes enrollment data via chrome.storage.local.
 *
 * NOT a module — popup scripts in Manifest V3 must be classic scripts
 * (no import/export), which is why popup.html loads it with a plain <script> tag.
 */

// ---------------------------------------------------------------------------
// MODULE-LEVEL STATE
// ---------------------------------------------------------------------------

// Holds the current Chrome tab object once we query it on DOMContentLoaded.
// We store it at module scope so all event handlers can access it without
// re-querying Chrome (each query is asynchronous, so caching avoids latency).
let currentTab = null;

// Tracks whether VisionGuard is currently enabled on this tab.
// Updated after every communication with background.js.
let isActive = false;

// ---------------------------------------------------------------------------
// DOM REFERENCES
// ---------------------------------------------------------------------------

// Cache DOM elements once to avoid repeated document.getElementById calls.
// These are assigned inside DOMContentLoaded once the HTML is fully parsed.
let statusBadge = null; // <span id="status-badge">
let toggleBtn = null;   // <button id="toggle-btn">
let enrolledName = null; // <span id="enrolled-name">
let enrollBtn = null;    // <button id="enroll-btn">
let resetBtn = null;     // <button id="reset-btn">

// ---------------------------------------------------------------------------
// STORAGE KEY
// Must match the key used in content-script.js and enrollment.js so we read
// the same data that the AI pipeline stores.
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'visionguard_enrolled_identity_v1';

// ---------------------------------------------------------------------------
// INITIALISATION
// ---------------------------------------------------------------------------

/**
 * DOMContentLoaded fires when the popup's HTML is fully parsed.
 * We wait for it before touching any DOM elements to avoid null reference errors.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Grab references to all UI elements now that the DOM is ready.
  statusBadge  = document.getElementById('status-badge');
  toggleBtn    = document.getElementById('toggle-btn');
  enrolledName = document.getElementById('enrolled-name');
  enrollBtn    = document.getElementById('enroll-btn');
  resetBtn     = document.getElementById('reset-btn');

  // --- Step 1: Discover the active tab ---
  // chrome.tabs.query returns an array; {active:true, currentWindow:true}
  // filters it to exactly the tab the user is looking at right now.
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

  // Guard: should always exist, but bail out gracefully if something is wrong.
  if (!tabs || tabs.length === 0) {
    setStatusUI(false); // Show "INACTIVE" — we don't know the tab state.
    return;
  }

  // Store the tab object for use in event handlers below.
  currentTab = tabs[0];

  // --- Step 2: Ask background.js for this tab's VisionGuard status ---
  chrome.runtime.sendMessage(
    { type: 'GET_TAB_STATUS', tabId: currentTab.id },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('[VisionGuard Popup] Could not read tab status:', chrome.runtime.lastError.message);
        setStatusUI(false);
        return;
      }
      // response.active comes from background.js's session-scoped tab state.
      isActive = response && response.active ? true : false;
      setStatusUI(isActive); // Reflect status in the popup immediately.
    }
  );

  // --- Step 3: Read enrollment info from chrome.storage.local ---
  // We read storage directly in the popup rather than asking the content script,
  // because the content script may not be injected yet (tab might be inactive).
  loadEnrollmentUI();

  // Reflect enrollment completion immediately while this popup remains open.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) loadEnrollmentUI();
  });

  // --- Step 4: Attach event listeners ---
  toggleBtn.addEventListener('click', handleToggle);
  enrollBtn.addEventListener('click', handleEnroll);
  resetBtn.addEventListener('click', handleReset);
});

// ---------------------------------------------------------------------------
// UI HELPERS
// ---------------------------------------------------------------------------

/**
 * Updates the status badge and toggle button to reflect the current active state.
 * @param {boolean} active - Whether VisionGuard is enabled on the current tab.
 */
function setStatusUI(active) {
  if (active) {
    // Green badge when the shield is on.
    statusBadge.textContent = 'ACTIVE ON THIS TAB';
    statusBadge.setAttribute('data-state', 'active'); // CSS uses this attribute for color.

    // The button now offers the inverse action — turning the shield off.
    toggleBtn.textContent = 'Disable Shield';
    toggleBtn.classList.add('vg-btn--active'); // Gives the button a "danger" tint.
  } else {
    // Muted badge when off.
    statusBadge.textContent = 'INACTIVE';
    statusBadge.setAttribute('data-state', 'inactive');

    // Button offers to turn the shield on.
    toggleBtn.textContent = 'Enable on This Tab';
    toggleBtn.classList.remove('vg-btn--active');
  }
}

/**
 * Reads chrome.storage.local and updates the enrolled identity display.
 * Uses a callback (not async/await) because storage.local callbacks fire
 * synchronously in extension service workers, keeping the popup responsive.
 */
function loadEnrollmentUI() {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (chrome.runtime.lastError) {
      console.error('[VisionGuard Popup] Could not read enrollment:', chrome.runtime.lastError.message);
      enrolledName.textContent = 'Enrollment unavailable';
      enrolledName.classList.remove('enrolled');
      return;
    }

    const data = result[STORAGE_KEY]; // The stored object (or undefined if nothing enrolled).

    if (data && data.name) {
      // Show the enrolled user's name so the user knows who is registered.
      enrolledName.textContent = data.name;
      enrolledName.classList.add('enrolled'); // CSS class adds a green color accent.
    } else {
      // No enrollment found — show placeholder text.
      enrolledName.textContent = 'Not Enrolled';
      enrolledName.classList.remove('enrolled');
    }
  });
}

// ---------------------------------------------------------------------------
// EVENT HANDLERS
// ---------------------------------------------------------------------------

/**
 * Handles the main Enable / Disable toggle button click.
 * Sends the appropriate message to background.js and updates the UI.
 */
function handleToggle() {
  if (!currentTab) return; // Safety guard — tab must have been resolved.

  if (!isActive) {
    // --- ACTIVATE ---
    // Tell background.js to inject the content script into this tab.
    toggleBtn.disabled = true;
    chrome.runtime.sendMessage(
      { type: 'ACTIVATE_TAB', tabId: currentTab.id },
      (response) => {
        toggleBtn.disabled = false;
        if (chrome.runtime.lastError) {
          alert(`VisionGuard could not activate on this page.\n\n${chrome.runtime.lastError.message}`);
          return;
        }
        if (response && response.success) {
          // Injection succeeded — update local state and UI.
          isActive = true;
          setStatusUI(true);
        } else {
          // Injection failed (e.g., restricted page like chrome://settings).
          const errMsg = response && response.error ? response.error : 'Unknown error.';
          alert(`VisionGuard could not activate on this page.\n\n${errMsg}`);
        }
      }
    );
  } else {
    // --- DEACTIVATE ---
    // Tell background.js to stop monitoring and clean up the content script.
    toggleBtn.disabled = true;
    chrome.runtime.sendMessage(
      { type: 'DEACTIVATE_TAB', tabId: currentTab.id },
      (response) => {
        toggleBtn.disabled = false;
        if (chrome.runtime.lastError) {
          alert(`VisionGuard could not deactivate on this page.\n\n${chrome.runtime.lastError.message}`);
          return;
        }
        if (response && response.success) {
          // Successfully disabled — update local state and UI.
          isActive = false;
          setStatusUI(false);
        }
      }
    );
  }
}

/**
 * Handles the "Enroll User" button click.
 * Tells the content script to begin the face capture / enrollment flow.
 * If VisionGuard is not active on the tab, shows a helpful error message.
 */
function handleEnroll() {
  if (!currentTab) return;

  if (!isActive) {
    // The content script is not injected yet, so there is no camera feed to capture from.
    // Guide the user to enable VisionGuard first.
    alert('Please enable VisionGuard on this tab first, then click "Enroll User".');
    return;
  }

  // Send START_ENROLLMENT to the content script running inside the active tab.
  // chrome.tabs.sendMessage routes to the content script (not background.js).
  chrome.tabs.sendMessage(
    currentTab.id,
    { type: 'START_ENROLLMENT' },
    (response) => {
      if (chrome.runtime.lastError) {
        alert(`Could not reach VisionGuard on the page.\n\n${chrome.runtime.lastError.message}`);
        return;
      }
      if (!response || !response.started) {
        alert(response && response.error
          ? response.error
          : 'VisionGuard is still starting. Wait for the camera widget, then retry enrollment.');
      }
    }
  );
}

/**
 * Handles the "Reset" button click.
 * Removes the stored biometric vector from chrome.storage.local,
 * effectively un-enrolling the authorized user.
 */
function handleReset() {
  // Ask for confirmation to prevent accidental data wipe.
  if (!confirm('Remove the enrolled biometric profile? You will need to re-enroll to use VisionGuard.')) {
    return; // User cancelled — do nothing.
  }

  // Delete the enrollment entry from chrome.storage.local.
  // After deletion the content script will also detect the missing enrollment
  // on its next inference cycle and transition to CAUTION state automatically.
  chrome.storage.local.remove(STORAGE_KEY, () => {
    if (chrome.runtime.lastError) {
      console.error('[VisionGuard Popup] Could not reset enrollment:', chrome.runtime.lastError.message);
      alert(`Could not reset the enrolled identity.\n\n${chrome.runtime.lastError.message}`);
      return;
    }
    // Refresh the enrollment section in the popup to show "Not Enrolled".
    loadEnrollmentUI();
  });
}
