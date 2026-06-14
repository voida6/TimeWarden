// The page shown when a site is blocked. store.js is loaded first.
// `reason` selects the messaging: "limit" (out of time), "focus" (focus hours)
// or "window" (outside the site's allowed hours).

const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
const reason = params.get("reason") || "limit";
const from = params.get("from") || "";

const $ = (id) => document.getElementById(id);
$("domain").textContent = domain || "this site";

const COPY = {
  limit: { glyph: "⏳", title: "Time's up for today" },
  focus: { glyph: "🎯", title: "Focus hours" },
  window: { glyph: "🌙", title: "Outside allowed hours" },
};

(async () => {
  const copy = COPY[reason] || COPY.limit;
  $("glyph").textContent = copy.glyph;
  $("title").textContent = copy.title;

  const status = domain ? await getStatus(domain) : null;

  if (reason === "limit") {
    $("snooze").classList.remove("hidden"); // a snooze only makes sense for the time limit
    if (status && status.limited) {
      $("sub").textContent =
        `You've used your ${status.limitMinutes}-minute limit` +
        (status.bonusMinutes ? ` (+${status.bonusMinutes}m snooze)` : "") + ".";
    }
    $("fine").textContent = "Limits reset at midnight. Edit them from the TimeWarden popup.";
  } else if (reason === "focus") {
    const focus = await getFocus();
    $("sub").textContent = `Focus hours are on (${focus.start}–${focus.end}). This site is paused.`;
    $("fine").textContent = "Change focus hours in TimeWarden settings.";
  } else if (reason === "window") {
    $("sub").textContent = status && status.window
      ? `This site is only available ${describeWindow(status.window)}.`
      : "This site is outside its allowed hours.";
    $("fine").textContent = "Change the allowed hours in TimeWarden settings.";
  }
})();

$("back").addEventListener("click", () => {
  // Try to close the tab; if the browser won't allow it, fall back to history.
  chrome.tabs.getCurrent((tab) => {
    if (tab && tab.id != null) chrome.tabs.remove(tab.id);
    else history.length > 1 ? history.back() : (location.href = "about:blank");
  });
});

$("snooze").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "snooze", domain, minutes: 5 });
  // Return to where they were (or just the site root) now that there's headroom.
  location.href = from || `https://${domain}`;
});
