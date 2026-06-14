// Popup: shows the active site's usage against its limit, lets you set/remove a
// limit for it, and lists every site you've limited. store.js is loaded first.

let currentDomain = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  $("today").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentDomain = domainFromUrl(tab && tab.url);

  await renderCurrent();
  await renderList();

  $("save").addEventListener("click", onSave);
  $("remove").addEventListener("click", onRemove);
  $("limit").addEventListener("keydown", (e) => { if (e.key === "Enter") onSave(); });
  $("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
});

async function renderCurrent() {
  if (!currentDomain) {
    $("site").textContent = "This page can't be limited";
    $("used").textContent = "";
    $("limit").disabled = true;
    $("save").disabled = true;
    $("hint").textContent = "Open a normal website to set a limit.";
    return;
  }

  $("site").textContent = currentDomain;
  const status = await getStatus(currentDomain);
  $("used").textContent = formatDuration(status.used) + " today";

  if (status.limited) {
    $("limit").value = status.limitMinutes;
    $("remove").classList.remove("hidden");
    const pct = Math.min(100, (status.used / status.effectiveSeconds) * 100);
    $("bar").classList.remove("hidden");
    $("fill").style.width = pct + "%";
    $("fill").style.background = status.blocked ? "var(--danger)" : "var(--accent)";
  } else {
    $("limit").value = "";
    $("remove").classList.add("hidden");
    $("bar").classList.add("hidden");
  }

  $("hint").textContent = await hintFor(status);
}

// One-line status: blocking reason takes priority, then time remaining.
async function hintFor(status) {
  if (status.blocked) {
    if (status.reason === "focus") {
      const focus = await getFocus();
      return `Blocked now — focus hours (${focus.start}–${focus.end}).`;
    }
    if (status.reason === "window") {
      return status.window
        ? `Blocked now — only allowed ${describeWindow(status.window)}.`
        : "Blocked now — outside allowed hours.";
    }
    return "Limit reached for today.";
  }
  if (status.limited) {
    const remaining = Math.max(0, status.effectiveSeconds - status.used);
    return `${formatDuration(remaining)} left today` +
      (status.bonusMinutes ? ` (incl. +${status.bonusMinutes}m snooze)` : "");
  }
  if (status.window) return `Allowed only ${describeWindow(status.window)}.`;
  return "No limit set for this site.";
}

async function onSave() {
  if (!currentDomain) return;
  const minutes = parseInt($("limit").value, 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    $("hint").textContent = "Enter a number of minutes (1 or more).";
    return;
  }
  await setLimit(currentDomain, minutes);
  await chrome.runtime.sendMessage({ type: "recheck" }).catch(() => {});
  await renderCurrent();
  await renderList();
}

async function onRemove() {
  if (!currentDomain) return;
  await setLimit(currentDomain, 0);
  await renderCurrent();
  await renderList();
}

async function renderList() {
  const domains = await getManagedDomains();
  const ul = $("list");
  ul.innerHTML = "";

  $("empty").classList.toggle("hidden", domains.length > 0);

  for (const domain of domains) {
    const status = await getStatus(domain);

    const li = document.createElement("li");

    const main = document.createElement("div");
    main.className = "li-main";

    const name = document.createElement("div");
    name.className = "li-domain";
    name.textContent = domain;
    main.appendChild(name);

    // Progress bar only makes sense for a minute limit.
    if (status.limited) {
      const pct = Math.min(100, (status.used / status.effectiveSeconds) * 100);
      const bar = document.createElement("div");
      bar.className = "li-bar";
      const fill = document.createElement("div");
      fill.className = "li-fill" + (status.blocked ? " over" : "");
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      main.appendChild(bar);
    }

    const meta = document.createElement("div");
    meta.className = "li-meta";
    const parts = [];
    if (status.limited) parts.push(`${formatDuration(status.used)} / ${status.limitMinutes}m`);
    else parts.push(formatDuration(status.used));
    if (status.window) parts.push(describeWindow(status.window));
    if (status.blocked) parts.push(status.reason === "focus" ? "focus" : "blocked");
    meta.textContent = parts.join(" · ");
    main.appendChild(meta);

    const remove = document.createElement("button");
    remove.className = "li-remove";
    remove.title = "Remove";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      await setLimit(domain, 0);
      await setWindow(domain, null);
      await renderList();
      if (domain === currentDomain) await renderCurrent();
    });

    li.append(main, remove);
    ul.appendChild(li);
  }
}
