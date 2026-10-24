import { useCallback, useEffect, useState } from "react";
import { Globe } from "lucide-react";
import {
  ALL_SITES_PATTERN, SITES, originPatterns, type Settings, type SiteProfile,
} from "@jpresence/shared";
import { Section, Toggle } from "../components/ui";

type Props = { settings: Settings; update: (patch: (s: Settings) => Settings) => void };

async function hasAccess(origins: string[]): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins });
  } catch {
    return false;
  }
}

export type AccessResult = { ok: boolean; error?: string };

/** Must be called from a click handler (browser requirement). Shows Chrome's own permission prompt. */
async function requestAccess(origins: string[]): Promise<AccessResult> {
  try {
    const ok = await chrome.permissions.request({ origins });
    return ok ? { ok } : { ok, error: chrome.runtime.lastError?.message ?? "Chrome reported the request was declined or dismissed." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const why = (r: AccessResult) => `Access was not granted. ${r.error ?? ""}`.trim();

export function WebSection({ settings, update }: Props) {
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [granted, setGranted] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const next: Record<string, boolean> = {};
    for (const s of SITES) next[s.id] = await hasAccess(originPatterns(s));
    next.other = await hasAccess([ALL_SITES_PATTERN]);
    setAccess(next);
    try {
      const all = await chrome.permissions.getAll();
      setGranted((all.origins ?? []).filter((o) => !/youtube.com/.test(o)));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const setSite = (id: string, v: boolean) =>
    update((s) => ({ ...s, web: { ...s.web, sites: { ...s.web.sites, [id]: v } } }));

  async function toggleSite(site: SiteProfile, on: boolean) {
    if (on) {
      const r = await requestAccess(originPatterns(site));
      setSite(site.id, r.ok);
      setNotice(r.ok ? `${site.name} enabled.` : why(r));
    } else {
      setSite(site.id, false);
      try { await chrome.permissions.remove({ origins: originPatterns(site) }); } catch { /* ignore */ }
    }
    await refresh();
  }

  async function enableAllPopular() {
    const origins = SITES.flatMap(originPatterns);
    const r = await requestAccess(origins);
    if (r.ok) {
      update((s) => ({
        ...s,
        web: { ...s.web, enabled: true, sites: Object.fromEntries(SITES.map((x) => [x.id, true])) },
      }));
      setNotice("Popular sites enabled.");
    } else setNotice(why(r));
    await refresh();
  }

  async function toggleOthers(on: boolean) {
    if (on) {
      const r = await requestAccess([ALL_SITES_PATTERN]);
      update((s) => ({ ...s, web: { ...s.web, allSites: r.ok } }));
      setNotice(r.ok ? "All other sites enabled (domain only)." : why(r));
    } else {
      update((s) => ({ ...s, web: { ...s.web, allSites: false } }));
      try { await chrome.permissions.remove({ origins: [ALL_SITES_PATTERN] }); } catch { /* ignore */ }
    }
    await refresh();
  }

  return (
    <Section title="Other websites" icon={<Globe size={14} />}>
      <p className="py-2 text-xs text-muted">
        Shows a fixed, private label such as “Chatting” on WhatsApp or “Watching Reels” on Instagram. Chat and social
        sites never share contact names, messages, page titles, usernames or links. Streaming sites can also show the
        title and progress of what you watch (switch below). It only runs on sites you allow. Your browser
        asks for permission per site.
      </p>
      <Toggle
        label="Enable website presence"
        hint="Master switch for everything below."
        checked={settings.web.enabled}
        onChange={(v) => update((s) => ({ ...s, web: { ...s.web, enabled: v } }))}
      />
      <Toggle
        label="Show elapsed time"
        checked={settings.web.showElapsed}
        onChange={(v) => update((s) => ({ ...s, web: { ...s.web, showElapsed: v } }))}
      />
      <Toggle
        label="Show what I'm watching on streaming sites"
        hint="Netflix, Prime Video, JioHotstar, Disney+ and similar: the movie/episode title. Off shows just “Watching Netflix”."
        checked={settings.web.showTitles}
        onChange={(v) => update((s) => ({ ...s, web: { ...s.web, showTitles: v } }))}
      />
      <Toggle
        label="Show progress bar on streaming sites"
        checked={settings.web.showProgress}
        onChange={(v) => update((s) => ({ ...s, web: { ...s.web, showProgress: v } }))}
      />
      <Toggle
        label="Show site icon"
        checked={settings.web.showIcon}
        onChange={(v) => update((s) => ({ ...s, web: { ...s.web, showIcon: v } }))}
      />
      <div className="flex items-center justify-between py-2">
        <span className="text-sm">Popular sites</span>
        <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white" onClick={() => void enableAllPopular()}>
          Enable all
        </button>
      </div>
      {SITES.map((site) => {
        const on = (settings.web.sites[site.id] ?? true) && !!access[site.id];
        return (
          <Toggle
            key={site.id}
            label={site.name}
            hint={`Shows “${site.defaultLabel}”${access[site.id] ? "" : " · needs access"}`}
            checked={on}
            onChange={(v) => void toggleSite(site, v)}
          />
        );
      })}
      <Toggle
        label="All other websites"
        hint="Shows “Browsing the web” and the domain only. Banks, email, health, government and similar sites are never shared."
        checked={settings.web.allSites && !!access.other}
        onChange={(v) => void toggleOthers(v)}
      />
      {notice && <p role="status" className="py-2 text-xs text-accent">{notice}</p>}
      <p className="py-2 text-[11px] text-muted">
        Granted sites: {granted.length ? granted.join("  ") : "none yet"}
      </p>
    </Section>
  );
}
