import { normalizeMedia, upgradeArtwork, type MediaState } from "@jpresence/shared";
import {
  firstText, largestArtwork, ms, pickVideo, playbackOf, text,
  type MediaProvider, type ProviderEnv,
} from "./types";

const TITLE = ["ytmusic-player-bar .title", ".title.ytmusic-player-bar"];
const BYLINE = ["ytmusic-player-bar .byline", ".byline.ytmusic-player-bar"];
const ART = [
  "ytmusic-player-bar img.image",
  "img.image.ytmusic-player-bar",
  "#song-image img",
  "ytmusic-player-page #song-image img",
];

/** "Artist • Album • 2020" or "Artist1 & Artist2 • Album". */
export function parseByline(raw: string | undefined): { artist?: string; album?: string } {
  if (!raw) return {};
  const parts = raw
    .split("•")
    .map((p) => p.trim())
    .filter((p) => p && !/\b(views?|likes?|plays?|subscribers?|listeners?)\b/i.test(p));
  const artist = parts[0];
  const album = parts[1] && !/^\d{4}$/.test(parts[1]) ? parts[1] : undefined;
  return { artist, album };
}

export class YouTubeMusicProvider implements MediaProvider {
  readonly source = "youtube-music" as const;
  matches(url: URL) {
    return url.hostname === "music.youtube.com";
  }

  read({ doc, url, now }: ProviderEnv): MediaState | null {
    const meta = typeof navigator !== "undefined" ? navigator.mediaSession?.metadata : null;
    const domTitle = firstText(doc, TITLE);
    const byline = parseByline(firstText(doc, BYLINE));
    // The player bar is the source of truth for what is current; mediaSession fills gaps
    // only when it agrees with the DOM title (avoids stale metadata after a skip).
    const msOk = meta?.title && (!domTitle || meta.title === domTitle);
    const title = domTitle ?? (meta?.title || undefined);
    if (!title) return null;
    const artist = byline.artist ?? (msOk ? meta?.artist || undefined : undefined);
    const album = byline.album ?? (msOk ? meta?.album || undefined : undefined);

    let art = msOk ? largestArtwork(meta?.artwork) : undefined;
    if (!art) {
      for (const s of ART) {
        const src = (doc.querySelector(s) as HTMLImageElement | null)?.src;
        if (src && /^https:/.test(src)) { art = src; break; }
      }
    }

    const video = pickVideo(doc);
    let duration = video && Number.isFinite(video.duration) ? video.duration : undefined;
    let position = video?.currentTime;
    if (!duration) {
      const bar = doc.querySelector("#progress-bar, tp-yt-paper-slider#progress-bar");
      const max = Number(bar?.getAttribute("aria-valuemax"));
      const val = Number(bar?.getAttribute("aria-valuenow"));
      if (max > 0) { duration = max; position = Number.isFinite(val) ? val : position; }
    }

    const id = url.searchParams.get("v");
    const mediaUrl = id && /^[\w-]{11}$/.test(id) ? `https://music.youtube.com/watch?v=${id}` : undefined;
    const adShowing = Boolean(text(doc.querySelector("ytmusic-player-bar .advertisement")));
    void adShowing;

    return normalizeMedia(
      {
        source: "youtube-music",
        title,
        creator: artist,
        album,
        mediaUrl,
        artworkUrl: upgradeArtwork(art, "youtube-music"),
        durationMs: ms(duration),
        positionMs: ms(position),
        playbackState: playbackOf(video),
        updatedAt: now,
      },
      now,
    );
  }
}
