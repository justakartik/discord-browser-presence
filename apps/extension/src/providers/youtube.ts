import { normalizeMedia, youtubeThumbnail, youtubeVideoId, type MediaState } from "@jpresence/shared";
import { firstText, ms, pickVideo, playbackOf, type MediaProvider, type ProviderEnv } from "./types";

const TITLE_SELECTORS = [
  "ytd-watch-metadata h1 yt-formatted-string",
  "ytd-watch-metadata h1",
  "#above-the-fold #title h1",
  "h1.ytd-video-primary-info-renderer",
  "ytd-reel-video-renderer[is-active] .ytReelMultiFormatLinkViewModelEndpoint span",
  "ytd-reel-video-renderer[is-active] h2",
  "yt-shorts-video-title-view-model h2",
];
const CHANNEL_SELECTORS = [
  "ytd-watch-metadata ytd-channel-name #text a",
  "ytd-watch-metadata ytd-channel-name a",
  "#owner ytd-channel-name a",
  "ytd-reel-video-renderer[is-active] ytd-channel-name a",
  "ytd-reel-player-header-renderer ytd-channel-name a",
  "yt-reel-channel-bar-view-model a",
];

function cleanDocTitle(doc: Document): string | undefined {
  const t = doc.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "").trim();
  return t && t !== "YouTube" ? t : undefined;
}

export class YouTubeProvider implements MediaProvider {
  readonly source = "youtube" as const;
  matches(url: URL) {
    return url.hostname === "www.youtube.com" || url.hostname === "m.youtube.com" || url.hostname === "youtube.com";
  }

  read({ doc, url, now }: ProviderEnv): MediaState | null {
    const id = youtubeVideoId(url.toString());
    if (!id) return null; // not on a video/short/live page
    // On Shorts there is one <video> per Short; use the active one.
    const video = pickVideo(doc, url.pathname.startsWith("/shorts/") ? "ytd-reel-video-renderer[is-active]" : undefined);
    if (!video) return null;

    // Staleness guard: on SPA navigation the watch element's video-id attribute updates
    // before/after the title does. If it disagrees with the URL, our metadata is stale.
    const flexy = doc.querySelector("ytd-watch-flexy");
    const flexyId = flexy?.getAttribute("video-id");
    if (url.pathname === "/watch" && flexyId && flexyId !== id) return null;

    const isShort = url.pathname.startsWith("/shorts/");
    const meta = typeof navigator !== "undefined" ? navigator.mediaSession?.metadata : null;
    // mediaSession is only trusted if it doesn't disagree with DOM on the title.
    const domTitle = firstText(doc, TITLE_SELECTORS);
    const title = domTitle ?? cleanDocTitle(doc) ?? (meta?.title || undefined);
    if (!title) return null;
    const creator = firstText(doc, CHANNEL_SELECTORS) ?? (meta?.artist || undefined);

    const player = doc.querySelector(".html5-video-player");
    const adShowing = player?.classList.contains("ad-showing") ?? false;
    const isLive =
      video.duration === Infinity ||
      Boolean(player?.classList.contains("ytp-live")) ||
      Boolean(flexy?.hasAttribute("is-live"));

    return normalizeMedia(
      {
        source: "youtube",
        title,
        creator,
        mediaUrl: isShort
          ? `https://www.youtube.com/shorts/${id}`
          : `https://www.youtube.com/watch?v=${id}`,
        artworkUrl: youtubeThumbnail(id),
        durationMs: isLive || adShowing ? undefined : ms(video.duration),
        positionMs: adShowing ? undefined : ms(video.currentTime),
        isLive,
        playbackState: playbackOf(video, adShowing),
        updatedAt: now,
      },
      now,
    );
  }
}
