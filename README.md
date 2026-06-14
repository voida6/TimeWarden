# TimeWarden

Set **daily time limits** for distracting websites. TimeWarden quietly tracks how
long you actively spend on a site each day and, once you hit the limit you set,
redirects the tab to a friendly "time's up" page until midnight.

Everything runs locally — no accounts, no servers, no data leaves your browser.

## Features

- **Per-site daily limits**, set in minutes from the toolbar popup or the
  settings page.
- **Accurate, idle-aware tracking** — time only counts while the tab is focused
  and you're actually at the keyboard (configurable).
- **Automatic blocking** the moment a site reaches its limit, across every open
  tab on that site.
- **Snooze** — grant yourself 5 more minutes from the block page when you really
  need it.
- **At-a-glance progress** bars in the popup, plus a full table and 7-day usage
  in settings.
- Limits reset automatically at your local midnight.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `TimeWarden` folder.

## Usage

- Click the toolbar icon while on a site, type a number of minutes, and hit
  **Set**. That's it.
- Manage every limit, change the idle threshold, or review usage from
  **Manage all & settings** (also at `chrome://extensions` → Details → Extension
  options).

## How it works

The service worker (`background.js`) tracks time using wall-clock timestamps
rather than counting ticks, so it stays accurate even when Chrome suspends the
worker. A once-a-minute heartbeat — plus tab, focus and idle events — banks the
elapsed time for the active site and blocks it if it's over budget.

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, permissions, popup/options registration |
| `background.js` | Time tracking, limit checks, blocking |
| `store.js` | Shared storage helpers (limits, usage, overrides, settings) |
| `popup.*` | Toolbar popup — current site + quick limit + list |
| `options.*` | Full management table and settings |
| `block.*` | The "time's up" page with snooze |

## Permissions

- `storage` — save your limits and usage locally.
- `tabs` — read the active tab's URL to know which site to time, and redirect it
  when a limit is reached.
- `alarms` — the 1-minute heartbeat and daily cleanup.
- `idle` — pause counting when you step away.

No host permissions are requested; TimeWarden never reads page content.
