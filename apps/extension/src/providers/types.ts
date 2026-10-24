import type { MediaState, Source } from "@jpresence/shared";

export type ProviderEnv = {
  doc: Document;
  /** location of the page (injected for tests) */
  url: URL;
  now: number;
};

export interface MediaProvider {
  readonly source: Source;
  matches(url: URL): boolean;
  /** Returns the current media or null when nothing (non-stale) is available. */
  read(env: ProviderEnv): MediaState | null;
}

export const text = (el: Element | null | undefined): string | undefined => {
  const t = el?.textContent?.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
};

export function firstText(doc: Document, selectors: string[]): string | undefined {
  for (const s of selectors) {
    try {
      const t = text(doc.querySelector(s));
      if (t) return t;
    } catch {
      /* invalid selector in this engine: skip */
    }
  }
  return undefined;
}

/**
 * YouTube keeps several `video.html5-main-video` elements in the page at once: the home-page masthead ad, the
 * hover-preview player, and the real watch player. After you click a video on the home page the other two stay in
 * the DOM (paused, and the masthead comes first), so "the first one" reports Paused for the whole video.
 */
const NOT_THE_MAIN_PLAYER = "#masthead-player, ytd-video-masthead-ad-primary-video-renderer, ytd-video-preview, #inline-preview-player";

export function pickVideo(doc: Document, preferWithin?: string): HTMLVideoElement | null {
  const all = Array.from(doc.querySelectorAll("video"));
  if (all.length === 0) return null;
  let pool = all.filter((v) => !v.closest(NOT_THE_MAIN_PLAYER));
  if (pool.length === 0) pool = all;
  // The element inside the active container (e.g. the current Short), else inside the main watch player.
  const preferred = preferWithin ? pool.filter((v) => v.closest(preferWithin)) : [];
  if (preferred.length) pool = preferred;
  else {
    const inMain = pool.filter((v) => v.closest("#movie_player"));
    if (inMain.length) pool = inMain;
  }
  const score = (v: HTMLVideoElement) =>
    (!v.paused && !v.ended ? 8 : 0) +
    (v.classList.contains("html5-main-video") ? 4 : 0) +
    (Number.isFinite(v.duration) && v.duration > 0 ? 2 : 0) +
    (v.readyState > 0 ? 1 : 0);
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function playbackOf(v: HTMLVideoElement | null, adShowing = false) {
  if (!v) return "stopped" as const;
  if (v.ended) return "ended" as const;
  if (adShowing) return "buffering" as const;
  if (v.paused) return "paused" as const;
  if (v.readyState < 3) return "buffering" as const;
  return "playing" as const;
}

export const ms = (sec: number | undefined): number | undefined =>
  typeof sec === "number" && Number.isFinite(sec) && sec >= 0 ? Math.round(sec * 1000) : undefined;

export function largestArtwork(art: readonly { src: string; sizes?: string }[] | undefined): string | undefined {
  if (!art?.length) return undefined;
  const size = (a: { sizes?: string }) => parseInt((a.sizes ?? "").split("x")[0] ?? "0", 10) || 0;
  return [...art].sort((a, b) => size(b) - size(a))[0]?.src;
}
