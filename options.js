// Options page: add sites, set per-site daily limits and allowed-time windows,
// configure global focus hours, view a 7-day usage chart, and tweak settings.
// store.js is loaded first.

const $ = (id) => document.getElementById(id);
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]; // Sun..Sat

document.addEventListener("DOMContentLoaded", async () => {
  $("add-form").addEventListener("submit", onAdd);

  await initFocus();
  await initSettings();
  await renderChart();
  await renderSites();
});

// --- Day-chip picker, reused by focus hours and each site window ---

function makeDayChips(selected, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "days";
  const set = new Set(selected && selected.length ? selected : [0, 1, 2, 3, 4, 5, 6]);
  for (let d = 0; d < 7; d++) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip" + (set.has(d) ? " on" : "");
    chip.textContent = DAY_LETTERS[d];
    chip.title = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d];
    chip.addEventListener("click", () => {
      set.has(d) ? set.delete(d) : set.add(d);
      chip.classList.toggle("on");
      onChange([...set].sort((a, b) => a - b));
    });
    wrap.appendChild(chip);
  }
  return wrap;
}

// --- Add a site ---

async function onAdd(e) {
  e.preventDefault();
  const raw = $("add-domain").value.trim();
  const minutesRaw = $("add-minutes").value.trim();
  const err = $("add-error");

  const domain = raw.includes("://") ? domainFromUrl(raw) : normaliseDomain(raw);
  if (!domain) {
    return showError(err, "Enter a valid website, e.g. youtube.com");
  }

  // Minutes are optional — a site can be managed by an allowed window alone.
  if (minutesRaw !== "") {
    const minutes = parseInt(minutesRaw, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return showError(err, "Limit must be a number of minutes (or left blank).");
    }
    await setLimit(domain, minutes);
  } else {
    // Make sure the site shows up even with no limit yet.
    const windows = await getWindows();
    const limits = await getLimits();
    if (!limits[domain] && !windows[domain]) {
      await setWindow(domain, { start: "09:00", end: "17:00", days: [], enabled: false });
    }
  }

  err.classList.add("hidden");
  $("add-domain").value = "";
  $("add-minutes").value = "";
  await recheck();
  await renderSites();
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

function normaliseDomain(input) {
  const host = input.replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase().trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

// --- Focus hours ---

async function initFocus() {
  const focus = await getFocus();
  $("focus-enabled").checked = focus.enabled;
  $("focus-start").value = focus.start;
  $("focus-end").value = focus.end;

  const daysHost = $("focus-days");
  daysHost.innerHTML = "";
  daysHost.appendChild(makeDayChips(focus.days, (days) => setFocus({ days }).then(recheck)));

  const apply = () => {
    $("focus-fields").classList.toggle("disabled", !$("focus-enabled").checked);
  };
  apply();

  $("focus-enabled").addEventListener("change", async () => {
    await setFocus({ enabled: $("focus-enabled").checked });
    apply();
    await recheck();
  });
  $("focus-start").addEventListener("change", () => setFocus({ start: $("focus-start").value }).then(recheck));
  $("focus-end").addEventListener("change", () => setFocus({ end: $("focus-end").value }).then(recheck));
}

// --- 7-day chart ---

async function renderChart() {
  const days = await getDailyTotals(7);
  const max = Math.max(60, ...days.map((d) => d.total)); // floor avoids a wall of full bars
  const host = $("chart");
  host.innerHTML = "";

  days.forEach((d, i) => {
    const col = document.createElement("div");
    col.className = "chart-col";

    const val = document.createElement("div");
    val.className = "chart-val";
    val.textContent = d.total ? formatDuration(d.total) : "";

    const barWrap = document.createElement("div");
    barWrap.className = "chart-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "chart-bar" + (d.total ? "" : " empty") + (i === days.length - 1 ? " today" : "");
    bar.style.height = Math.max(2, Math.round((d.total / max) * 100)) + "%";
    bar.title = `${formatDuration(d.total)} on ${d.key}`;
    barWrap.appendChild(bar);

    const label = document.createElement("div");
    label.className = "chart-label";
    label.textContent = i === days.length - 1
      ? "Today"
      : d.date.toLocaleDateString(undefined, { weekday: "short" });

    col.append(val, barWrap, label);
    host.appendChild(col);
  });
}

// --- Site cards ---

async function renderSites() {
  const domains = await getManagedDomains();
  const host = $("sites");
  host.innerHTML = "";
  $("empty").classList.toggle("hidden", domains.length > 0);

  for (const domain of domains) {
    host.appendChild(await buildSiteCard(domain));
  }
}

async function buildSiteCard(domain) {
  const status = await getStatus(domain);
  const windows = await getWindows();
  const card = document.createElement("div");
  card.className = "site-card";

  // Header: name, today's usage, remove.
  const head = document.createElement("div");
  head.className = "site-head";
  const name = document.createElement("span");
  name.className = "site-name";
  name.textContent = domain;
  const today = document.createElement("span");
  today.className = "site-today muted";
  today.textContent = `${formatDuration(status.used)} today`;
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  const remove = document.createElement("button");
  remove.className = "row-remove";
  remove.title = "Remove site";
  remove.textContent = "×";
  remove.addEventListener("click", async () => {
    await setLimit(domain, 0);
    await setWindow(domain, null);
    await recheck();
    await renderSites();
  });
  head.append(name, today, spacer, remove);

  // Daily limit row.
  const limitRow = document.createElement("div");
  limitRow.className = "site-row";
  const limitLabel = document.createElement("label");
  limitLabel.textContent = "Daily limit";
  const limitInput = document.createElement("input");
  limitInput.type = "number";
  limitInput.min = "1";
  limitInput.max = "1440";
  limitInput.className = "row-limit";
  limitInput.placeholder = "—";
  if (status.limitMinutes) limitInput.value = status.limitMinutes;
  const minLabel = document.createElement("span");
  minLabel.className = "muted";
  minLabel.textContent = "min";
  limitInput.addEventListener("change", async () => {
    const m = parseInt(limitInput.value, 10);
    await setLimit(domain, Number.isFinite(m) && m > 0 ? m : 0);
    await recheck();
    await renderSites();
  });
  limitRow.append(limitLabel, limitInput, minLabel);

  // Allowed-window row (read the raw stored window so disabled ones still prefill).
  const win = windows[domain] || null;
  const winRow = document.createElement("div");
  winRow.className = "site-row";
  const winToggleLabel = document.createElement("label");
  const winToggle = document.createElement("input");
  winToggle.type = "checkbox";
  winToggle.checked = !!(win && win.enabled);
  winToggleLabel.append(winToggle, document.createTextNode(" Only allow during set hours"));
  winRow.appendChild(winToggleLabel);

  const fields = document.createElement("div");
  fields.className = "win-fields" + (winToggle.checked ? "" : " disabled");

  const startWrap = document.createElement("label");
  startWrap.className = "time";
  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.value = (win && win.start) || "09:00";
  startWrap.append(document.createTextNode("From "), startInput);

  const endWrap = document.createElement("label");
  endWrap.className = "time";
  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.value = (win && win.end) || "17:00";
  endWrap.append(document.createTextNode("to "), endInput);

  let winDays = (win && win.days) || [];
  const daysPicker = makeDayChips(winDays, (d) => { winDays = d; saveWindow(); });

  fields.append(startWrap, endWrap, daysPicker);

  // Persist the window from the current control values, or clear it when off.
  async function saveWindow() {
    if (winToggle.checked) {
      await setWindow(domain, {
        enabled: true,
        start: startInput.value || "09:00",
        end: endInput.value || "17:00",
        days: winDays,
      });
    } else {
      // Keep the site managed (if it has a limit) but drop the window rule.
      const limits = await getLimits();
      if (limits[domain]) {
        await setWindow(domain, null);
      } else {
        // No limit either — remember the disabled window so the card stays.
        await setWindow(domain, {
          enabled: false,
          start: startInput.value || "09:00",
          end: endInput.value || "17:00",
          days: winDays,
        });
      }
    }
    await recheck();
  }

  winToggle.addEventListener("change", async () => {
    fields.classList.toggle("disabled", !winToggle.checked);
    await saveWindow();
  });
  startInput.addEventListener("change", saveWindow);
  endInput.addEventListener("change", saveWindow);

  card.append(head, limitRow, winRow, fields);
  return card;
}

// --- Settings ---

async function initSettings() {
  const settings = await getSettings();
  $("track-idle").checked = settings.trackWhileIdle;
  $("idle-seconds").value = settings.idleSeconds;
  $("track-idle").addEventListener("change", saveSettings);
  $("idle-seconds").addEventListener("change", saveSettings);
}

async function saveSettings() {
  const idleSeconds = Math.max(15, Math.min(3600, parseInt($("idle-seconds").value, 10) || 60));
  $("idle-seconds").value = idleSeconds;
  await setSettings({ trackWhileIdle: $("track-idle").checked, idleSeconds });
  await recheck();
}

function recheck() {
  return chrome.runtime.sendMessage({ type: "recheck" }).catch(() => {});
}
