// Shared storage helpers used by the service worker, popup, options page and
// block page. All persistent data lives in chrome.storage.local under a few keys:
//
//   limits    { "<domain>": <minutes> }                 daily limit per site
//   usage     { "<YYYY-MM-DD>": { "<domain>": <seconds> } }   time spent
//   overrides { "<YYYY-MM-DD>": { "<domain>": <minutes> } }   snooze bonus time
//   settings  { trackWhileIdle: bool, idleSeconds: int }
//
// The transient "current session" (which domain is being timed right now) lives
// in chrome.storage.session so it clears when the browser closes.

const LIMITS_KEY = "limits";
const USAGE_KEY = "usage";
const OVERRIDES_KEY = "overrides";
const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS = { trackWhileIdle: false, idleSeconds: 60 };

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

async function getSettings() {
  const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function setSettings(patch) {
  const settings = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, ...patch } });
}

// Seconds spent on a domain today.
async function getUsedSeconds(domain, key = dateKey()) {
  const { [USAGE_KEY]: usage = {} } = await chrome.storage.local.get(USAGE_KEY);
  return (usage[key] && usage[key][domain]) || 0;
}

// Bonus minutes granted today via "snooze".
async function getOverrideMinutes(domain, key = dateKey()) {
  const { [OVERRIDES_KEY]: overrides = {} } = await chrome.storage.local.get(OVERRIDES_KEY);
  return (overrides[key] && overrides[key][domain]) || 0;
}

// A site is blocked when it has a limit and today's usage meets the limit plus
// any snooze bonus. Returns { limited, used, limitMinutes, effectiveSeconds, blocked }.
async function getStatus(domain, key = dateKey()) {
  const limits = await getLimits();
  const limitMinutes = limits[domain];
  if (!limitMinutes) {
    return { limited: false, used: await getUsedSeconds(domain, key) };
  }
  const used = await getUsedSeconds(domain, key);
  const bonus = await getOverrideMinutes(domain, key);
  const effectiveSeconds = (limitMinutes + bonus) * 60;
  return {
    limited: true,
    used,
    limitMinutes,
    bonusMinutes: bonus,
    effectiveSeconds,
    blocked: used >= effectiveSeconds,
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
