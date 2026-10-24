import { DEFAULT_SETTINGS, type Settings } from "@jpresence/shared";
import { MediaMonitor } from "./monitor";
import { WebProvider } from "../providers/web";
import { loadSettings, onSettingsChanged } from "../services/settingsStore";

// Registered dynamically only for sites the user granted access to (see background/webScripts.ts).
let settings: Settings = DEFAULT_SETTINGS;
let lastActivity = Date.now();
let dead = false;

const provider = new WebProvider({
  getSettings: () => settings,
  lastActivityAt: () => lastActivity,
  incognito: chrome.extension?.inIncognitoContext === true,
});

const monitor: MediaMonitor = new MediaMonitor({
  doc: document,
  getUrl: () => new URL(location.href),
  provider,
  pollMs: 5000,
  skipWhenHidden: true,
  emit: (media) => {
    if (dead) return;
    try {
      const msg = media ? { type: "media", media } : { type: "media-stop" };
      void chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      dead = true; // extension was reloaded/updated: stop quietly
      monitor.stop();
    }
  },
});

let throttle = 0;
const touch = () => {
  const now = Date.now();
  if (now - throttle < 1000) return;
  throttle = now;
  lastActivity = now;
};
for (const e of ["mousemove", "keydown", "scroll", "click", "touchstart", "wheel"]) {
  addEventListener(e, touch, { passive: true, capture: true });
}

const win = window as unknown as { __jpWebMonitor?: { stop(): void } };
try { win.__jpWebMonitor?.stop(); } catch { /* orphaned instance */ }
win.__jpWebMonitor = monitor;
void loadSettings().then((s) => {
  settings = s;
  monitor.start();
});
onSettingsChanged((s) => {
  settings = s;
  monitor.evaluate();
});
addEventListener("pagehide", () => monitor.stop());
