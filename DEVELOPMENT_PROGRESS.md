# Development progress

Statuses: Not started · In progress · Implemented · Tested · Blocked. "Tested" = automated tests pass; live = real Chrome + real Discord.

| Task | Status | Files | Tests / results | Known issues / next |
|---|---|---|---|---|
| Self-development prompt | Implemented | docs/SELF_DEVELOPMENT_PROMPT.md | n/a | — |
| Monorepo, TS strict, Vite, Tailwind, Vitest, ESLint | Tested | root configs, build scripts | typecheck/lint/build clean | — |
| Shared logic (validation, selection, activity, artwork, settings) | Tested | packages/shared | tests/shared.test.ts | — |
| YouTubeProvider | Tested (jsdom fixtures) | providers/youtube.ts | title/channel/thumb/live/shorts/ads/stale-nav | **Live selectors unverified on real YouTube** |
| YouTubeMusicProvider | Tested (jsdom fixtures) | providers/youtubeMusic.ts | track change, stale mediaSession, artwork | **Live selectors unverified** |
| MediaMonitor (events, seek, heartbeat) | Tested | content/monitor.ts | tests/providers.test.ts | SPA events fire only in real page |
| Background PresenceManager, multi-tab, reconnect | Tested | background/presence.ts | tests/background.test.ts | MV3 worker restart path (`storage.session` restore) untested |
| Companion: Discord IPC, host, native framing | Tested vs fake Discord | apps/companion | tests/companion.test.ts, e2e.test.ts | **Real Discord unverified**; auth-less SET_ACTIVITY relies on known IPC behaviour (docs describe AUTHORIZE for general RPC) |
| Pipeline ext→companion→Discord (both sources) | Tested (fake Discord) | tests/e2e.test.ts | pass; found & fixed epoch-timestamp validation bug | — |
| Popup + options UI | Implemented | popup/, options/ | built; no rendering tests | Add React Testing Library tests; visual QA in Chrome pending |
| Packaging: extension zip, SEA exe, install/uninstall.ps1 | Tested (exe stdio smoke) | scripts/package.mjs, installer/ | tests/packaged-exe.test.ts | install.ps1/uninstall.ps1 **not executed** here; exe unsigned |
| Docs | Implemented | docs/, README | — | — |
| Dependency audit | Tested | — | `pnpm audit`: none known | — |

## "Shows paused while playing" investigation (2026-10-24)
Live checks on real YouTube and YouTube Music pages (built content script + stubbed chrome): state detection is correct (playing/paused/ads/transitions), one <video> element each. Likely cause of the report: after an extension reload, tabs that were already open kept a dead old content script and never got the new one until refreshed, so a paused tab could be the only one reporting. Fixes: background now injects the content scripts into already-open YouTube tabs and granted-site tabs on install/reload and on permission grants, and a new injection stops any previous instance (verified live: 3 re-injections leave exactly 1 live monitor). Also: companion log now records source/paused/timer flags (never titles); YouTube Music byline no longer treats "1.8B views" as the album. **Not confirmed with the user's real Chrome yet**; if it still happens, host.log now shows exactly which state was sent.

## Streaming sites: title + progress (2026-10-24)
Status: Implemented; logic Tested with simulated players (20 tests in tests/ott.test.ts: title selectors, Media Session and tab-title fallbacks, trailer/ad filtering, paused/hidden/idle rules, title/progress switches, activity + Discord mapping). **Not verified on the real sites** (no accounts/DRM access here): the Netflix/Prime title selectors are best-effort and may need adjusting; other sites rely on Media Session / tab title. Next: check each site on a real machine and adjust `player` hints in packages/shared/src/sites.ts.

## Memory / performance audit (2026-10-24)
- Measured (Windows, Node 24 single-executable companion): idle 37.8 MB working set / 20.9 MB private / 13 threads per companion process. Almost all of that is the Node runtime itself; V8 flags only shave ~2 MB (now applied: `--max-old-space-size=24 --max-semi-space-size=1` -> 34.5 MB / 18.9 MB).
- Biggest practical win: the extension now closes the native connection 60 s after there is nothing to show, so the companion process exits (0 MB when idle) and Chrome's background worker can sleep. It reconnects on demand.
- Leak hunt (`node scripts/stress.mjs`): 300k state updates across 50 tabs -> +0.05 MB heap, tab map bounded; companion host + Discord pipe with thousands of updates and hundreds of Discord restarts -> heap plateaus (~+0.8 MB one-time warm-up, same at 1x and 5x load), sockets/handles return to baseline after shutdown; content-script monitor start/stop x2000 -> zero leaked listeners. No leaks found.
- Fixes: in-session log rotation (size was only checked at startup), web pages poll every 5 s and not at all while the tab is hidden.
- A native rewrite (Go/Rust, ~2-5 MB) would be the only way to go much lower; no toolchain is installed here, so not done.

## v0.2.0 - website presence (2026-10-24)
Status: Implemented; logic Tested (89 automated tests: classification/privacy, blocklist, settings, selection, activity mapping, WebProvider in jsdom, script registration, sender checks). **Not verified live** in Chrome: the optional-permission prompt, dynamic content-script registration and real Instagram/WhatsApp pages. The Discord `name` override was verified against the live Discord client with a probe.

## Resolved (2026-10-16): buttons/badge missing from the browser path
Root cause: environment, not code. Shell commands run from the Claude desktop app are in an MSIX package whose writes to `%LOCALAPPDATA%`/`%APPDATA%` are redirected to a private copy. Chrome reads the real folders, so it kept launching the old exe that was installed manually the day before; every "reinstall" from the agent session only changed the private copy. Fix: installed the new exe into the real folder via a one-off Windows scheduled task (processes started by Task Scheduler are not redirected). After that the Chrome-launched host sent buttons + badge and Discord accepted both (see `last-activity.json`). Also fixed: installer no longer waits for a key press when stdout is not a console; startup trace is size-capped; Chrome launches are detected by the `chrome-extension://` argument instead of `isTTY`.
Lesson recorded in docs/DEVELOPMENT.md.

## Previous open issue (kept for history, as of 2026-10-15 night)
Buttons ("Watch/Listen Along", "GitHub") and the play/pause badge do not show when presence comes from the browser, but DO work when the installed exe is driven directly (probe script sends a setActivity; Discord's reply accepted buttons, badge asset and proxied image).
- Finding: Chrome-launched `jpresence-host.exe` processes never wrote `host.log` / `last-activity.json`, while direct and `cmd /c`-wrapped launches did. Presence text/progress still appears in Discord from the browser path, so it is unclear which process publishes it.
- Suspects: (1) Chrome launches the host with a stripped environment; diagnostics now write next to the exe (`path.dirname(process.execPath)`), build installed, but still no log after 100 s with no reload of the extension; (2) the extension's background worker may be asleep and not relaunching the host; (3) an older activity may be lingering in Discord.
- Next: reload extension + YouTube tab, play 15 s, read `%LOCALAPPDATA%\Justakartik\Presence\host.log` and `last-activity.json`; check the extension service-worker console for errors; confirm which process holds the Discord pipe.
- Not yet in a GitHub release: the diagnostics build (release v0.1.0 contains the earlier exe).

## Blocked / needs the user
- Create two Discord applications and supply client IDs.
- Live verification in Chrome with Discord running.
