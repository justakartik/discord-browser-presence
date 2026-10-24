import { HOST_NAME, normalizeMedia } from "@jpresence/shared";
import { PresenceManager } from "./presence";
import { loadSettings, onSettingsChanged } from "../services/settingsStore";
import {
  isFromContentScript, isFromExtensionPage, parseContentMessage, parseUiMessage, senderMatchesSource,
  type PopupState,
} from "../services/messages";
import { injectIntoOpenTabs, syncWebScripts } from "./webScripts";

const version = chrome.runtime.getManifest().version;
let manager: PresenceManager | null = null;

async function init(): Promise<PresenceManager> {
  if (manager) return manager;
  const settings = await loadSettings();
  manager = new PresenceManager(
    {
      connectNative: () => chrome.runtime.connectNative(HOST_NAME),
      getLastError: () => chrome.runtime.lastError?.message,
      now: () => Date.now(),
      version,
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as number),
      onChange: persist,
    },
    settings,
  );
  onSettingsChanged((s) => manager?.setSettings(s));
  // Restore tab state after service-worker restart; content scripts re-report within seconds,
  // and stale entries are expired by the sweep below.
  try {
    const r = await chrome.storage.session.get("tabs");
    for (const [id, media] of Object.entries((r.tabs ?? {}) as Record<string, unknown>)) {
      const m = normalizeMedia(media);
      if (m) manager.update(Number(id), m);
    }
  } catch { /* storage.session unavailable */ }
  setInterval(() => manager?.expire(), 10_000);
  return manager;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    const m = manager?.current();
    try { await chrome.storage.session.set({ current: m ?? null }); } catch { /* ignore */ }
  }, 300);
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const extId = chrome.runtime.id;
  void (async () => {
    const m = await init();
    const content = parseContentMessage(raw);
    if (content) {
      if (!isFromContentScript(sender, extId)) return sendResponse({ ok: false });
      const tabId = sender.tab!.id!;
      if (content.type === "media-stop") m.remove(tabId);
      else {
        const media = normalizeMedia(content.media);
        if (media && senderMatchesSource(sender.url, media.source)) m.update(tabId, media);
        else m.remove(tabId);
      }
      return sendResponse({ ok: true });
    }
    const ui = parseUiMessage(raw);
    if (ui && isFromExtensionPage(sender, extId, chrome.runtime.getURL(""))) {
      if (ui.type === "reconnect") m.reconnect();
      if (ui.type === "clear-local-data") {
        m.clearAll();
        await chrome.storage.session.clear().catch(() => {});
        await chrome.storage.local.clear().catch(() => {});
      }
      const state: PopupState = {
        media: m.current(), status: m.status, settings: await loadSettings(),
        extensionVersion: version, activeTabs: m.tabCount(),
      };
      return sendResponse(state);
    }
    sendResponse({ ok: false });
  })();
  return true; // async response
});

// Site access is granted per site by the user; keep the dynamic content script in step with it.
chrome.permissions.onAdded.addListener(() => void syncWebScripts().then(() => injectIntoOpenTabs({ youtube: false, web: true })));
chrome.permissions.onRemoved.addListener(() => void syncWebScripts());
chrome.runtime.onInstalled.addListener(
  () => void syncWebScripts().then(() => injectIntoOpenTabs({ youtube: true, web: true })),
);
chrome.runtime.onStartup.addListener(() => void syncWebScripts());

chrome.tabs.onRemoved.addListener((tabId) => { void init().then((m) => m.remove(tabId)); });
chrome.runtime.onStartup.addListener(() => { void init(); });
chrome.runtime.onInstalled.addListener(() => { void init(); });
void init();
