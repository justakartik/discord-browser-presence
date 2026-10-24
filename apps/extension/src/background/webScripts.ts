export const WEB_SCRIPT_ID = "jp-web";

/** YouTube is handled by the static content script; the web script must never run there too. */
export const YOUTUBE_EXCLUDES = [
  "https://www.youtube.com/*",
  "https://music.youtube.com/*",
  "https://m.youtube.com/*",
  "https://youtube.com/*",
];

const STATIC = new Set(["https://www.youtube.com/*", "https://music.youtube.com/*", "https://m.youtube.com/*"]);

/** Granted origin patterns the web content script should run on (https only, minus the static YouTube ones). */
export function webMatches(origins: readonly string[] | undefined): string[] {
  return [...new Set((origins ?? []).filter((o) => /^https:\/\/[^/]+\/\*$/.test(o) && !STATIC.has(o)))];
}

const YOUTUBE_TABS = ["https://www.youtube.com/*", "https://music.youtube.com/*", "https://m.youtube.com/*"];

/**
 * Chrome only injects declared content scripts on navigation, so after an extension reload/update (or after the
 * user grants a site) tabs that were already open have a dead or missing script. Inject into them directly.
 * The scripts replace any previous instance themselves, so this is safe to repeat.
 */
export async function injectIntoOpenTabs(opts: { youtube: boolean; web: boolean }): Promise<void> {
  try {
    if (opts.youtube) {
      for (const t of await chrome.tabs.query({ url: YOUTUBE_TABS })) {
        if (t.id !== undefined) await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
      }
    }
    if (opts.web) {
      const perms = await chrome.permissions.getAll();
      const matches = webMatches(perms.origins);
      if (matches.length === 0) return;
      for (const t of await chrome.tabs.query({ url: matches })) {
        if (t.id === undefined || !t.url || YOUTUBE_EXCLUDES.some((p) => t.url!.startsWith(p.replace("/*", "/")))) continue;
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["webcontent.js"] }).catch(() => {});
      }
    }
  } catch {
    /* best effort */
  }
}

/** Registers/updates/removes the dynamic content script to match the permissions the user has granted. */
export async function syncWebScripts(): Promise<void> {
  try {
    const perms = await chrome.permissions.getAll();
    const matches = webMatches(perms.origins);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [WEB_SCRIPT_ID] });
    if (matches.length === 0) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [WEB_SCRIPT_ID] });
      return;
    }
    const script = {
      id: WEB_SCRIPT_ID,
      js: ["webcontent.js"],
      matches,
      excludeMatches: YOUTUBE_EXCLUDES,
      runAt: "document_idle" as const,
      allFrames: false,
      persistAcrossSessions: true,
    };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch {
    /* scripting unavailable: web presence simply stays off */
  }
}
