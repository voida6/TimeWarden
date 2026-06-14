// The page shown when a site hits its daily limit. store.js is loaded first.

const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
const from = params.get("from") || "";

document.getElementById("domain").textContent = domain || "this site";

(async () => {
  if (domain) {
    const status = await getStatus(domain);
    if (status.limited) {
      document.getElementById("sub").textContent =
        `You've used your ${status.limitMinutes}-minute limit` +
        (status.bonusMinutes ? ` (+${status.bonusMinutes}m snooze)` : "") + ".";
    }
  }
})();

document.getElementById("back").addEventListener("click", () => {
  // Try to close the tab; if the browser won't allow it, fall back to history.
  chrome.tabs.getCurrent((tab) => {
    if (tab && tab.id != null) chrome.tabs.remove(tab.id);
    else history.length > 1 ? history.back() : (location.href = "about:blank");
  });
});

document.getElementById("snooze").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "snooze", domain, minutes: 5 });
  // Return to where they were (or just the site root) now that there's headroom.
  location.href = from || `https://${domain}`;
});
