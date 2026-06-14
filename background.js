// TimeWarden service worker.
//
// Time tracking is timestamp-based rather than counting ticks, so it stays
// accurate even when the service worker is suspended: we remember which domain
// is being timed and when timing started, and on every "tick" we add the real
// elapsed wall-clock time to today's usage.
//
// A tick runs on: a 1-minute heartbeat alarm, tab activation, tab URL changes,
// window focus changes, and idle-state changes. Each tick (1) banks the elapsed
// time for the previously active domain, (2) figures out what's active now, and
// (3) starts timing that — or blocks it if it's already over its limit.

importScripts("store.js");

const SESSION_KEY = "currentSession"; // { domain, startedAt } in storage.session
const HEARTBEAT_ALARM = "timewarden-heartbeat";
const PRUNE_ALARM = "timewarden-prune";

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

async function init() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: 720 }); // twice a day
  const { idleSeconds } = await getSettings();
  chrome.idle.setDetectionInterval(Math.max(15, idleSeconds));
  tick();
}

// --- Event wiring: every relevant change re-evaluates what's being timed. ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) tick();
  else if (alarm.name === PRUNE_ALARM) pruneOldUsage();
});

chrome.tabs.onActivated.addListener(() => tick());
chrome.windows.onFocusChanged.addListener(() => tick());
chrome.idle.onStateChanged.addListener(() => tick());

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // React when a tab navigates to a new URL: re-time and, if the destination is
  // already over its limit, block it immediately.
  if (changeInfo.url) tick();
});

// --- The heart of it ---

let ticking = null; // simple in-process lock so overlapping events don't double-count

function tick() {
  ticking = (ticking || Promise.resolve()).then(runTick).catch((e) => {
    console.error("TimeWarden tick failed", e);
  });
  return ticking;
}

async function runTick() {
  const now = Date.now();

  // 1. Bank elapsed time for whatever we were timing.
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  if (session && session.domain) {
    const elapsed = Math.round((now - session.startedAt) / 1000);
    if (elapsed > 0 && elapsed < 3600) {
      // Cap a single bank at 1h to absorb clock jumps / long suspensions.
      await addUsage(session.domain, elapsed);
    }
    const status = await getStatus(session.domain);
    if (status.blocked) await blockDomain(session.domain, status.reason);
  }

  // 2. What is the user actually looking at right now?
  const activeDomain = await currentActiveDomain();

  // 3. If it's over its limit, block it and time nothing. Otherwise start timing.
  let next = null;
  if (activeDomain) {
    const status = await getStatus(activeDomain);
    if (status.blocked) {
      await blockDomain(activeDomain, status.reason);
    } else {
      next = { domain: activeDomain, startedAt: now };
    }
  }
  await chrome.storage.session.set({ [SESSION_KEY]: next });
}

// The domain of the focused window's active tab, or null if the browser is
// unfocused, idle/locked (unless tracking-while-idle is on), or on a non-web page.
async function currentActiveDomain() {
  const settings = await getSettings();
  if (!settings.trackWhileIdle) {
    const state = await chrome.idle.queryState(Math.max(15, settings.idleSeconds));
    if (state !== "active") return null;
  }
  let win;
  try {
    win = await chrome.windows.getLastFocused({ populate: true });
  } catch {
    return null;
  }
  if (!win || !win.focused) return null;
  const tab = (win.tabs || []).find((t) => t.active);
  return tab ? domainFromUrl(tab.url) : null;
}

async function addUsage(domain, seconds) {
  const key = dateKey();
  const { usage = {} } = await chrome.storage.local.get("usage");
  if (!usage[key]) usage[key] = {};
  usage[key][domain] = (usage[key][domain] || 0) + seconds;
  await chrome.storage.local.set({ usage });
}

// Redirect every open tab sitting on this domain to the block page.
async function blockDomain(domain, reason = "limit") {
  const blockBase = chrome.runtime.getURL("block.html");
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (domainFromUrl(tab.url) === domain) {
      const url = `${blockBase}?domain=${encodeURIComponent(domain)}` +
        `&reason=${encodeURIComponent(reason)}` +
        `&from=${encodeURIComponent(tab.url)}`;
      chrome.tabs.update(tab.id, { url }).catch(() => {});
    }
  }
}

// Keep only the last 7 days of usage so storage doesn't grow forever.
async function pruneOldUsage() {
  const { usage = {}, overrides = {} } = await chrome.storage.local.get(["usage", "overrides"]);
  const cutoff = dateKey(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const prune = (obj) => {
    for (const k of Object.keys(obj)) if (k < cutoff) delete obj[k];
  };
  prune(usage);
  prune(overrides);
  await chrome.storage.local.set({ usage, overrides });
}

// --- Messages from popup / block page ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "snooze") {
    grantSnooze(msg.domain, msg.minutes).then(() => sendResponse({ ok: true }));
    return true; // async response
  }
  if (msg.type === "recheck") {
    tick().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Add bonus minutes for today and unblock any tabs parked on the block page.
async function grantSnooze(domain, minutes) {
  const key = dateKey();
  const { overrides = {} } = await chrome.storage.local.get("overrides");
  if (!overrides[key]) overrides[key] = {};
  overrides[key][domain] = (overrides[key][domain] || 0) + minutes;
  await chrome.storage.local.set({ overrides });
}
