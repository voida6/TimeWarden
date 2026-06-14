// Shared storage helpers used by the service worker, popup, options page and
// block page. All persistent data lives in chrome.storage.local under a few keys:
//
//   limits    { "<domain>": <minutes> }                        daily limit per site
//   windows   { "<domain>": { start, end, days[] } }           "only allow during" window
//   focus     { enabled, start, end, days[] }                  global focus hours
//   usage     { "<YYYY-MM-DD>": { "<domain>": <seconds> } }    time spent
//   overrides { "<YYYY-MM-DD>": { "<domain>": <minutes> } }    snooze bonus time
//   settings  { trackWhileIdle: bool, idleSeconds: int }
//
// Times are stored as "HH:MM" strings; days are arrays of weekday numbers
// (0 = Sunday … 6 = Saturday). An empty/omitted days array means "every day".
//
// The transient "current session" (which domain is being timed right now) lives
// in chrome.storage.session so it clears when the browser closes.

const LIMITS_KEY = "limits";
const WINDOWS_KEY = "windows";
const FOCUS_KEY = "focus";
const USAGE_KEY = "usage";
const OVERRIDES_KEY = "overrides";
const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS = { trackWhileIdle: false, idleSeconds: 60 };
const DEFAULT_FOCUS = { enabled: false, start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] };

// Local-date key like "2026-06-14" so usage rolls over at the user's midnight.
function dateKey(d = new Date()) {
  return d.toLocaleDateString("en-CA"); // en-CA renders as YYYY-MM-DD
}

// Reduce any URL to a bare, comparable host: lowercase, no "www.", no port.
// Returns null for anything we shouldn't track (extension pages, new tab, etc).
function domainFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// --- Time-window helpers ---

function parseHM(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

// True if today's weekday is in `days` (empty/missing means every day).
function dayActive(days, d = new Date()) {
  return !days || days.length === 0 || days.includes(d.getDay());
}

// True if `d` falls inside the [start, end) window on an active day. Supports
// overnight windows where end < start (e.g. 22:00–06:00).
function isWithinWindow(startHM, endHM, days, d = new Date()) {
  if (!dayActive(days, d)) return false;
  const cur = nowMinutes(d);
  const s = parseHM(startHM);
  const e = parseHM(endHM);
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

// --- Limits ---

async function getLimits() {
  const { [LIMITS_KEY]: limits = {} } = await chrome.storage.local.get(LIMITS_KEY);
  return limits;
}

async function setLimit(domain, minutes) {
  const limits = await getLimits();
  if (minutes == null || minutes <= 0) {
    delete limits[domain];
  } else {
    limits[domain] = minutes;
  }
  await chrome.storage.local.set({ [LIMITS_KEY]: limits });
}

// --- Allowed-time windows (per site) ---

async function getWindows() {
  const { [WINDOWS_KEY]: windows = {} } = await chrome.storage.local.get(WINDOWS_KEY);
  return windows;
}

async function setWindow(domain, win) {
  const windows = await getWindows();
  if (!win) {
    delete windows[domain];
  } else {
    windows[domain] = win;
  }
  await chrome.storage.local.set({ [WINDOWS_KEY]: windows });
}

// --- Focus hours (global) ---

async function getFocus() {
  const { [FOCUS_KEY]: focus = {} } = await chrome.storage.local.get(FOCUS_KEY);
  return { ...DEFAULT_FOCUS, ...focus };
}

async function setFocus(patch) {
  const focus = await getFocus();
  await chrome.storage.local.set({ [FOCUS_KEY]: { ...focus, ...patch } });
}

function focusActiveNow(focus, d = new Date()) {
  return !!focus.enabled && isWithinWindow(focus.start, focus.end, focus.days, d);
}

// --- Settings ---

async function getSettings() {
  const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function setSettings(patch) {
  const settings = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, ...patch } });
}

// --- Usage ---

async function getUsedSeconds(domain, key = dateKey()) {
  const { [USAGE_KEY]: usage = {} } = await chrome.storage.local.get(USAGE_KEY);
  return (usage[key] && usage[key][domain]) || 0;
}

async function getOverrideMinutes(domain, key = dateKey()) {
  const { [OVERRIDES_KEY]: overrides = {} } = await chrome.storage.local.get(OVERRIDES_KEY);
  return (overrides[key] && overrides[key][domain]) || 0;
}

// Total seconds tracked per day for the last `days` days, oldest first.
// Each entry: { key, date, total }.
async function getDailyTotals(days = 7) {
  const { [USAGE_KEY]: usage = {} } = await chrome.storage.local.get(USAGE_KEY);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000);
    const day = usage[dateKey(date)] || {};
    const total = Object.values(day).reduce((a, b) => a + b, 0);
    out.push({ key: dateKey(date), date, total });
  }
  return out;
}

// Every domain the user manages, via a limit and/or an allowed-time window.
async function getManagedDomains() {
  const [limits, windows] = await Promise.all([getLimits(), getWindows()]);
  return Array.from(new Set([...Object.keys(limits), ...Object.keys(windows)])).sort();
}

// Full picture for a domain right now. `blocked` is true when any rule forbids
// access, with `reason` telling which: "focus", "window" or "limit" (in that
// priority order).
async function getStatus(domain, key = dateKey()) {
  const [limits, windows, focus] = await Promise.all([getLimits(), getWindows(), getFocus()]);
  const limitMinutes = limits[domain];
  const win = windows[domain] || null;
  const winEnabled = !!(win && win.enabled);
  // A site is "managed" (shown in lists) if it has any rule; it's an active
  // focus target only if it has a real, enabled rule.
  const managed = !!limitMinutes || !!win;
  const focusTarget = !!limitMinutes || winEnabled;
  const used = await getUsedSeconds(domain, key);

  let blocked = false;
  let reason = null;

  // Focus hours block every site with an active rule, regardless of time used.
  if (focusTarget && focusActiveNow(focus)) {
    blocked = true;
    reason = "focus";
  }

  // Allowed-time window: blocked whenever we're outside it.
  const windowAllowedNow = winEnabled ? isWithinWindow(win.start, win.end, win.days) : true;
  if (!blocked && winEnabled && !windowAllowedNow) {
    blocked = true;
    reason = "window";
  }

  // Daily minute limit.
  let bonusMinutes = 0;
  let effectiveSeconds;
  if (limitMinutes) {
    bonusMinutes = await getOverrideMinutes(domain, key);
    effectiveSeconds = (limitMinutes + bonusMinutes) * 60;
    if (!blocked && used >= effectiveSeconds) {
      blocked = true;
      reason = "limit";
    }
  }

  return {
    managed,
    limited: !!limitMinutes,
    used,
    limitMinutes,
    bonusMinutes,
    effectiveSeconds,
    window: winEnabled ? win : null,
    windowAllowedNow,
    blocked,
    reason,
  };
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// "18:00–20:00" plus a compact day summary, for display.
function describeWindow(win) {
  if (!win) return "";
  const range = `${win.start}–${win.end}`;
  const days = win.days || [];
  if (days.length === 0 || days.length === 7) return range;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sorted = [...days].sort((a, b) => a - b);
  // Recognise the common weekday/weekend shorthands.
  if (sorted.join() === "1,2,3,4,5") return `${range}, weekdays`;
  if (sorted.join() === "0,6") return `${range}, weekends`;
  return `${range}, ${sorted.map((d) => names[d]).join(" ")}`;
}
