# Discord Browser Presence

**by [Justakartik](https://github.com/justakartik)**

Show what you do in your browser as your Discord status. Spotify-style activity for **YouTube**, **YouTube Music**, streaming sites (Netflix, Prime Video, ...) and, privately, the rest of your browsing (WhatsApp, Instagram, ...): title, channel/artist, real thumbnail/album art and a progress bar, updated automatically and processed locally.


```
Browser tab (YouTube, streaming, websites) ──► Chrome extension (MV3) ──native messaging──► companion (jpresence-host.exe) ──local IPC──► Discord desktop
```

Why a companion? Discord only accepts Rich Presence over a *local* named pipe; a browser extension cannot open one, and Discord OAuth2 does not allow changing presence of a user account. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## One-line install (Windows, Chrome or Edge)
Open **Windows PowerShell** and run:
```powershell
irm https://raw.githubusercontent.com/justakartik/discord-browser-presence/main/install.ps1 | iex
```
It downloads the latest release, verifies its SHA-256 checksums, installs the companion (the Discord application IDs are built in), unpacks the extension to `%LOCALAPPDATA%\Justakartik\Presence\extension` and opens `chrome://extensions`. Chrome doesn't let scripts add extensions, so the last step is yours: turn on *Developer mode*, click *Load unpacked*, and choose that folder (the path is copied to your clipboard). Run the same command again to update, then click reload on the extension.

Remove everything with:
```powershell
irm https://raw.githubusercontent.com/justakartik/discord-browser-presence/main/uninstall.ps1 | iex
```
Prefer to read a script before running it? Open [install.ps1](install.ps1) first; it is short.

## Manual download & setup (Windows, Chrome or Edge)
1. Open the [latest release](https://github.com/justakartik/discord-browser-presence/releases/latest) and download:
   - `JustakartikPresence.exe`
   - `justakartik-presence-extension.zip`
2. **Install the companion:** double-click `JustakartikPresence.exe`. A console window confirms the install and waits for a key press. No admin rights are needed. Windows SmartScreen may warn because the exe is unsigned: click *More info → Run anyway*.
3. **Install the extension:** unzip `justakartik-presence-extension.zip` into a folder you will keep (for example `C:\Tools\JustakartikPresence`). Open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked* and select that folder.
4. **Discord:** open the Discord desktop app (not the browser version). Under *User Settings → Activity Privacy*, turn on "Share your detected activities".
5. Play something on YouTube or YouTube Music. The extension popup shows Companion and Discord status.

Optional: upload `play.png`, `pause.png` and `logo.png` from `discord-assets.zip` to your Discord application (Rich Presence → Art Assets) with the names `play`, `pause` and `logo`. They provide the play/pause badge and a fallback image.

Other people see the "Listen Along" / "Watch Along" and GitHub buttons on your profile. Discord does not show buttons to you on your own profile.

### Where the exe lives
- Installed copy (the one the browser launches): `%LOCALAPPDATA%\Justakartik\Presence\jpresence-host.exe`. Open it with `explorer %LOCALAPPDATA%\Justakartik\Presence`.
- Config override (optional): `%APPDATA%\Justakartik\Presence\config.json`.
- Uninstall: `JustakartikPresence.exe --uninstall --remove-config`, then remove the extension in `chrome://extensions`.

You don't need to start the exe by hand. The browser starts and stops it automatically.

## Build from source
```bash
pnpm install
node scripts/gen-assets.mjs     # icons + pinned extension key (first time)
pnpm package                    # builds and assembles release/
```
Details: [docs/INSTALLATION.md](docs/INSTALLATION.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Other websites (Instagram, WhatsApp Web, Facebook, ...)
Besides YouTube and YouTube Music the extension can show a **fixed, private label** for other sites, for example *Playing WhatsApp · Chatting*, *Watching Instagram · Watching Reels*, *Playing X · Scrolling the timeline*.

- **Opt-in per site.** Open the extension settings -> *Other websites* and enable a site (or *Enable all* popular sites). Chrome shows its own permission prompt for each; nothing runs on a site you did not allow. Open tabs of that site are picked up automatically.
- **Private by design.** On chat and social sites only the site and the first part of the address are used to pick a label. Contact names, messages, usernames, page titles, links and search terms are never read, stored or sent. Websites never get "Listen/Watch Along" buttons because no link is shared.
- **Streaming sites show what you watch.** On Netflix, Prime Video, JioHotstar, Disney+, Hulu, Max, Crunchyroll, SonyLIV, ZEE5 and Apple TV the extension also reads the video player: title, position and duration. Discord then shows *Watching Netflix · &lt;title&gt;* with a progress bar and a play/pause badge, like YouTube. Turn the title and/or progress off in Settings -> Other websites (title off shows just *Watching Netflix*). Titles are found from the player, the browser's media info or the tab title, so a site redesign can make a title fall back to *Watching &lt;site&gt;*. Trailers, previews and ads (videos under 5 minutes) are ignored.
- **Only while you are there.** Shown while the tab is in front and you are active; cleared when the tab is hidden or after 2 minutes without input.
- **All other websites** (off by default) shows *Browsing the web* plus the domain only. Banks, email, health, government, login pages, IP addresses and intranet hosts are never shared.
- YouTube / YouTube Music playback takes priority over plain browsing; paused media gives way to the page you are actively using.

Built-in sites: Instagram, Facebook, Messenger, WhatsApp Web, Telegram Web, Snapchat Web, Discord (web), X/Twitter, Reddit, TikTok, Twitch, Netflix, Prime Video, JioHotstar, Disney+, Spotify Web, GitHub, Stack Overflow, ChatGPT, Claude, LinkedIn, Pinterest, Wikipedia. Labels are defined in [packages/shared/src/sites.ts](packages/shared/src/sites.ts); adding a site is one entry there.

## Commands
| | |
|---|---|
| `pnpm test` | all automated tests (Vitest) |
| `pnpm build` | build extension (`apps/extension/dist`) and bundle companion |
| `pnpm typecheck` / `pnpm lint` | strict TS / ESLint |
| `pnpm package` | `release/` with extension zip, `jpresence-host.exe`, install/uninstall scripts |

## Status
Automated tests cover detection logic, selection, activity building, protocol, Discord IPC (against a fake Discord pipe), reconnection, and the packaged exe over real stdio framing. Presence has been confirmed working by the author on Windows with Chrome and the Discord desktop app. Not independently verified: the button display for other users, Edge, and other machines. See [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md) and "Known limitations" in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

Docs: [Self-development prompt](docs/SELF_DEVELOPMENT_PROMPT.md) · [Architecture](docs/ARCHITECTURE.md) · [Installation](docs/INSTALLATION.md) · [Development](docs/DEVELOPMENT.md) · [Security](docs/SECURITY.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Release](docs/RELEASE.md)
