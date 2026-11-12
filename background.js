/**
 * VisionGuard – Privacy Shield
 * background.js — Manifest V3 Service Worker
 *
 * Tracks enabled tabs, injects the isolated vision pipeline, and routes
 * popup/content-script messages. Active tab IDs live in session storage so
 * service-worker suspension does not make the popup report a false inactive state.
 */

// Keep the enabled-tab list alive across service-worker restarts, but not browser restarts.
const ACTIVE_TABS_KEY = 'visionguard_active_tab_ids_v1';
let activeTabUpdateQueue = Promise.resolve();

/**
 * Reads the current session-scoped list and normalizes it to numeric tab IDs.
 * @returns {Promise<number[]>}
 */
async function getActiveTabIds() {
  const result = await chrome.storage.session.get(ACTIVE_TABS_KEY);
  const ids = result[ACTIVE_TABS_KEY];
  return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
}

/**
 * Adds or removes one tab ID without discarding other monitored tabs.
 * @param {number} tabId - The tab whose active marker should change.
 * @param {boolean} active - Whether the tab should remain marked active.
 * @returns {Promise<void>}
 */
async function setTabActive(tabId, active) {
  const update = activeTabUpdateQueue.then(async () => {
    const ids = new Set(await getActiveTabIds());
    if (active) ids.add(tabId);
    else ids.delete(tabId);
    await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: [...ids] });
  });
  // Serialize concurrent updates from different tabs without hiding their errors.
  activeTabUpdateQueue = update.catch((error) => {
    console.error('[VisionGuard BG] Queued tab-state update failed:', error);
  });
  return update;
}

/**
 * Handles popup actions and status notifications from injected content scripts.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, tabId } = message;

  if (type === 'GET_TAB_STATUS') {
    getActiveTabIds()
      .then((ids) => sendResponse({ active: ids.includes(tabId) }))
      .catch((error) => {
        console.error('[VisionGuard BG] Could not read tab status:', error);
        sendResponse({ active: false, error: error.message });
      });
    return true;
  }

  if (type === 'ACTIVATE_TAB') {
    if (!Number.isInteger(tabId)) {
      sendResponse({ success: false, error: 'A valid tab ID is required.' });
      return;
    }

    setTabActive(tabId, true)
      .then(() => injectContentScript(tabId))
      .then(() => sendResponse({ success: true }))
      .catch(async (error) => {
        try {
          await setTabActive(tabId, false);
        } catch (stateError) {
          console.error('[VisionGuard BG] Could not clear failed activation state:', stateError);
        }
        console.error('[VisionGuard BG] Injection failed for tab', tabId, error);
        sendResponse({ success: false, error: error.message || String(error) });
      });
    return true;
  }

  if (type === 'DEACTIVATE_TAB') {
    if (!Number.isInteger(tabId)) {
      sendResponse({ success: false, error: 'A valid tab ID is required.' });
      return;
    }

    setTabActive(tabId, false)
      .then(() => stopMonitoring(tabId))
      .then(sendResponse)
      .catch((error) => {
        console.error('[VisionGuard BG] Could not deactivate tab', tabId, error);
        sendResponse({ success: false, error: error.message || String(error) });
      });
    return true;
  }

  if (type === 'TAB_DEACTIVATED') {
    const senderTabId = sender.tab && sender.tab.id;
    if (!Number.isInteger(senderTabId)) {
      sendResponse({ acknowledged: false });
      return;
    }

    setTabActive(senderTabId, false)
      .then(() => removeShieldCss(senderTabId))
      .then((stylesRemoved) => sendResponse({ acknowledged: true, stylesRemoved }))
      .catch((error) => {
        console.error('[VisionGuard BG] Could not clear deactivated tab state:', error);
        sendResponse({ acknowledged: false, error: error.message || String(error) });
      });
    return true;
  }
});

/**
 * Stops the content script and reports whether it acknowledged cleanup.
 * A missing receiver is expected after navigation and does not leave a tab active.
 * @param {number} tabId - The tab to stop monitoring.
 * @returns {Promise<{success: boolean, stopped: boolean}>}
 */
async function stopMonitoring(tabId) {
  const response = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'STOP_MONITORING' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: true, stopped: false });
        return;
      }
      resolve({ success: true, stopped: Boolean(response && response.stopped) });
    });
  });
  const stylesRemoved = await removeShieldCss(tabId);
  return { ...response, stylesRemoved };
}

/**
 * Removes the injected stylesheet after UI teardown or an initialization failure.
 * @param {number} tabId - The tab from which the stylesheet should be removed.
 * @returns {Promise<boolean>}
 */
async function removeShieldCss(tabId) {
  try {
    await chrome.scripting.removeCSS({ target: { tabId }, files: ['shield.css'] });
    return true;
  } catch (error) {
    // The tab may have navigated or the stylesheet may never have been inserted.
    console.warn('[VisionGuard BG] Could not remove shield CSS from tab', tabId, error);
    return false;
  }
}

/**
 * Injects CSS and the complete vision pipeline into this extension's isolated world.
 * The isolated world preserves extension API access and keeps page CSP/scripts separate.
 * @param {number} tabId - The Chrome tab ID to inject into.
 * @returns {Promise<void>}
 */
async function injectContentScript(tabId) {
  let cssInserted = false;
  try {
    // Apply extension-owned styling before creating elements to avoid an unstyled flash.
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['shield.css'],
    });
    cssInserted = true;

    // Reuse the library in the isolated world on a same-page OFF/ON cycle.
    const [libraryState] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => typeof window.faceapi !== 'undefined',
    });

    // The vendor library and app must share the same isolated world to share faceapi.
    if (!libraryState || !libraryState.result) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['js/vendor/face-api.js'],
        world: 'ISOLATED',
      });
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['js/content-script.js'],
      world: 'ISOLATED',
    });
  } catch (error) {
    // Do not leave an injected stylesheet behind if the rest of activation fails.
    if (cssInserted) {
      await removeShieldCss(tabId);
    }
    throw error;
  }
}

/**
 * Removes the tab from session state when the browser closes it.
 */
chrome.tabs.onRemoved.addListener((closedTabId) => {
  setTabActive(closedTabId, false).catch((error) => {
    console.error('[VisionGuard BG] Could not clear closed-tab state:', error);
  });
});
