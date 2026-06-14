// Options page: add/edit/remove limits, see today's usage, tweak settings.
// store.js is loaded first.

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  $("add-form").addEventListener("submit", onAdd);

  const settings = await getSettings();
  $("track-idle").checked = settings.trackWhileIdle;
  $("idle-seconds").value = settings.idleSeconds;
  $("track-idle").addEventListener("change", saveSettings);
  $("idle-seconds").addEventListener("change", saveSettings);

  await renderTable();
});

async function onAdd(e) {
  e.preventDefault();
  const raw = $("add-domain").value.trim();
  const minutes = parseInt($("add-minutes").value, 10);
  const err = $("add-error");

  // Accept a bare domain or a full URL and normalise both to a host.
  const domain = raw.includes("://") ? domainFromUrl(raw) : normaliseDomain(raw);

  if (!domain) {
    err.textContent = "Enter a valid website, e.g. youtube.com";
    err.classList.remove("hidden");
    return;
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    err.textContent = "Enter a limit in minutes (1 or more).";
    err.classList.remove("hidden");
    return;
  }

  err.classList.add("hidden");
  await setLimit(domain, minutes);
  await chrome.runtime.sendMessage({ type: "recheck" }).catch(() => {});
  $("add-domain").value = "";
  $("add-minutes").value = "";
  await renderTable();
}

// Light validation for hand-typed domains (no protocol).
function normaliseDomain(input) {
  const host = input.replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase().trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

async function saveSettings() {
  const idleSeconds = Math.max(15, Math.min(3600, parseInt($("idle-seconds").value, 10) || 60));
  $("idle-seconds").value = idleSeconds;
  await setSettings({ trackWhileIdle: $("track-idle").checked, idleSeconds });
  // Let the worker pick up the new idle threshold immediately.
  await chrome.runtime.sendMessage({ type: "recheck" }).catch(() => {});
}

async function renderTable() {
  const limits = await getLimits();
  const domains = Object.keys(limits).sort();

  $("table").classList.toggle("hidden", domains.length === 0);
  $("empty").classList.toggle("hidden", domains.length > 0);

  const tbody = $("rows");
  tbody.innerHTML = "";

  for (const domain of domains) {
    const status = await getStatus(domain);
    const tr = document.createElement("tr");

    const site = document.createElement("td");
    site.textContent = domain;

    const today = document.createElement("td");
    today.textContent = formatDuration(status.used);
    if (status.blocked) today.classList.add("over");

    const limitCell = document.createElement("td");
    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.min = "1";
    limitInput.max = "1440";
    limitInput.value = status.limitMinutes;
    limitInput.className = "row-limit";
    limitInput.addEventListener("change", async () => {
      const m = parseInt(limitInput.value, 10);
      if (Number.isFinite(m) && m > 0) {
        await setLimit(domain, m);
        await chrome.runtime.sendMessage({ type: "recheck" }).catch(() => {});
        await renderTable();
      }
    });
    limitCell.appendChild(limitInput);

    const actions = document.createElement("td");
    const remove = document.createElement("button");
    remove.className = "row-remove";
    remove.title = "Remove";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      await setLimit(domain, 0);
      await renderTable();
    });
    actions.appendChild(remove);

    tr.append(site, today, limitCell, actions);
    tbody.appendChild(tr);
  }
}
