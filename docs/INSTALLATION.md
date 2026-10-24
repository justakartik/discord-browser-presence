# Installation (Windows, Chrome/Edge)

Prerequisite: Discord **desktop** app running (not the web client). Node.js is **not** needed.

## Quick install (from GitHub Releases)
1. Download from the [latest release](https://github.com/justakartik/discord-browser-presence/releases/latest):
   - `JustakartikPresence.exe` — double-click it (or run `JustakartikPresence.exe --install`). It installs the companion for your user and registers it with Chrome/Edge. No admin rights. Windows SmartScreen may warn because the exe is unsigned: *More info → Run anyway*.
   - `justakartik-presence-extension.zip` — unzip to a permanent folder, open `chrome://extensions`, enable *Developer mode* → *Load unpacked* → pick the folder. The extension ID is pinned and matches the companion.
2. In Discord: *User Settings → Activity Privacy* → enable "Share your detected activities".
3. Open YouTube / YouTube Music and play something.

The release exe already contains the maintainer's Discord application IDs ("YouTube" and "YouTube Music"). Client IDs are public identifiers, not secrets. To use your own apps, create `%APPDATA%\Justakartik\Presence\config.json`:
```json
{ "clientIds": { "youtube": "<id>", "youtubeMusic": "<id>" } }
```
Optional Discord art assets (per application, Rich Presence → Art Assets, from `discord-assets.zip`): `play`, `pause` (status badge) and `logo` (fallback image).

No "start on boot" is needed: the browser launches the companion when you open it and stops it when you close it.

## Other websites
Open the extension settings (gear in the popup) -> *Other websites*, then enable the sites you want or click *Enable all*. Chrome asks for permission per site. Reload open tabs of that site once. See the README for what is (and is never) shared.

## Uninstall
```bash
JustakartikPresence.exe --uninstall --remove-config
```
Then remove the extension in `chrome://extensions`.

## Building from source
See [DEVELOPMENT.md](DEVELOPMENT.md). `pnpm package` produces `release/` (the exe, extension zip, and the legacy `install.ps1`/`uninstall.ps1`).

## Chrome Web Store
The store assigns its own extension ID unless you upload with the same key; then run `JustakartikPresence.exe --install --extension-id <store id>`.
