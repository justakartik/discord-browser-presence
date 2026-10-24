// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { YouTubeProvider } from "../apps/extension/src/providers/youtube";
import { YouTubeMusicProvider, parseByline } from "../apps/extension/src/providers/youtubeMusic";
import { MediaMonitor } from "../apps/extension/src/content/monitor";
import { pickVideo } from "../apps/extension/src/providers/types";

const ID = "dQw4w9WgXcQ";
const env = (url: string, now = 1000) => ({ doc: document, url: new URL(url), now });

function setVideo(o: { paused?: boolean; ended?: boolean; duration?: number; currentTime?: number; readyState?: number } = {}) {
  const v = document.querySelector("video")!;
  const def = (k: string, val: unknown) => Object.defineProperty(v, k, { value: val, configurable: true });
  def("paused", o.paused ?? false); def("ended", o.ended ?? false);
  def("duration", o.duration ?? 200); def("currentTime", o.currentTime ?? 10); def("readyState", o.readyState ?? 4);
}
function ytPage(title: string, channel: string, id = ID) {
  document.title = `${title} - YouTube`;
  document.body.innerHTML = `
    <ytd-watch-flexy video-id="${id}"></ytd-watch-flexy>
    <div class="html5-video-player"><video class="html5-main-video"></video></div>
    <ytd-watch-metadata><h1><yt-formatted-string>${title}</yt-formatted-string></h1>
      <ytd-channel-name><div id="text"><a>${channel}</a></div></ytd-channel-name></ytd-watch-metadata>`;
  setVideo();
}
function setMediaSession(meta: unknown) {
  Object.defineProperty(navigator, "mediaSession", { value: { metadata: meta }, configurable: true });
}

beforeEach(() => { document.body.innerHTML = ""; setMediaSession(null); });

describe("YouTubeProvider", () => {
  const p = new YouTubeProvider();
  it("extracts title, channel, thumbnail, duration, position, playing", () => {
    ytPage("Some Video", "Some Channel");
    const m = p.read(env(`https://www.youtube.com/watch?v=${ID}`))!;
    expect(m).toMatchObject({ source: "youtube", title: "Some Video", creator: "Some Channel", playbackState: "playing", durationMs: 200000, positionMs: 10000 });
    expect(m.artworkUrl).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(m.mediaUrl).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
  it("play/pause/ended/buffering transitions", () => {
    ytPage("V", "C");
    const u = `https://www.youtube.com/watch?v=${ID}`;
    setVideo({ paused: true }); expect(p.read(env(u))!.playbackState).toBe("paused");
    setVideo({ ended: true, paused: true }); expect(p.read(env(u))!.playbackState).toBe("ended");
    setVideo({ readyState: 1 }); expect(p.read(env(u))!.playbackState).toBe("buffering");
  });
  it("returns null (no stale title) when SPA navigation hasn't updated the DOM yet", () => {
    ytPage("Old Video", "Old", "AAAAAAAAAAA");
    expect(p.read(env(`https://www.youtube.com/watch?v=${ID}`))).toBeNull();
  });
  it("returns null off video pages and without a video element", () => {
    ytPage("V", "C");
    expect(p.read(env("https://www.youtube.com/"))).toBeNull();
    document.body.innerHTML = "";
    expect(p.read(env(`https://www.youtube.com/watch?v=${ID}`))).toBeNull();
  });
  it("falls back to document.title and mediaSession when selectors miss", () => {
    document.title = "(3) Fallback Title - YouTube";
    document.body.innerHTML = `<div class="html5-video-player"><video></video></div>`;
    setVideo();
    setMediaSession({ title: "ignored", artist: "MS Artist", artwork: [] });
    const m = p.read(env(`https://www.youtube.com/watch?v=${ID}`))!;
    expect(m.title).toBe("Fallback Title");
    expect(m.creator).toBe("MS Artist");
  });
  it("live streams: no duration, isLive", () => {
    ytPage("Live!", "C");
    setVideo({ duration: Infinity });
    const m = p.read(env(`https://www.youtube.com/watch?v=${ID}`))!;
    expect(m.isLive).toBe(true);
    expect(m.durationMs).toBeUndefined();
  });
  it("shorts: uses shorts url and active reel metadata", () => {
    document.title = "Short thing - YouTube";
    document.body.innerHTML = `<div class="html5-video-player"><video class="html5-main-video"></video></div>
      <ytd-reel-video-renderer is-active><h2>Short thing</h2><ytd-channel-name><a>ShortChan</a></ytd-channel-name></ytd-reel-video-renderer>`;
    setVideo({ duration: 30 });
    const m = p.read(env(`https://www.youtube.com/shorts/${ID}`))!;
    expect(m).toMatchObject({ title: "Short thing", creator: "ShortChan", mediaUrl: `https://www.youtube.com/shorts/${ID}` });
  });
  it("ads: no position/duration leaked", () => {
    ytPage("V", "C");
    document.querySelector(".html5-video-player")!.classList.add("ad-showing");
    const m = p.read(env(`https://www.youtube.com/watch?v=${ID}`))!;
    expect(m.positionMs).toBeUndefined();
    expect(m.durationMs).toBeUndefined();
  });
});

describe("YouTubeMusicProvider", () => {
  const p = new YouTubeMusicProvider();
  const page = (title: string, byline: string, art = "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj") => {
    document.body.innerHTML = `<video></video>
      <ytmusic-player-bar><img class="image" src="${art}"><div class="title">${title}</div><div class="byline">${byline}</div></ytmusic-player-bar>`;
    setVideo({ duration: 180, currentTime: 42 });
  };
  it("parses byline", () => {
    expect(parseByline("Artist • Album • 2020")).toEqual({ artist: "Artist", album: "Album" });
    expect(parseByline("A & B")).toEqual({ artist: "A & B", album: undefined });
    expect(parseByline("A • 2020")).toEqual({ artist: "A", album: undefined });
    // video-type tracks: "Artist • 1.8B views • 19M likes" has no album
    expect(parseByline("Rick Astley • 1.8B views • 19M likes")).toEqual({ artist: "Rick Astley", album: undefined });
    expect(parseByline("Artist • Album • 3.2M plays")).toEqual({ artist: "Artist", album: "Album" });
  });
  it("extracts title/artist/album/artwork (upgraded)/times", () => {
    page("Song", "Artist • Album • 2021");
    const m = p.read(env("https://music.youtube.com/watch?v=" + ID))!;
    expect(m).toMatchObject({ source: "youtube-music", title: "Song", creator: "Artist", album: "Album", durationMs: 180000, positionMs: 42000, playbackState: "playing" });
    expect(m.artworkUrl).toBe("https://lh3.googleusercontent.com/abc=w512-h512");
    expect(m.mediaUrl).toBe(`https://music.youtube.com/watch?v=${ID}`);
  });
  it("track change updates title and ignores stale mediaSession", () => {
    page("Song A", "Artist A");
    setMediaSession({ title: "Song A", artist: "Artist A", album: "Old", artwork: [{ src: "https://lh3.googleusercontent.com/old=w512-h512", sizes: "512x512" }] });
    expect(p.read(env("https://music.youtube.com/watch?v=" + ID))!.title).toBe("Song A");
    page("Song B", "Artist B");
    const m = p.read(env("https://music.youtube.com/watch?v=" + ID))!;
    expect(m.title).toBe("Song B");
    expect(m.creator).toBe("Artist B");
    expect(m.album).toBeUndefined(); // stale "Old" album not borrowed
    expect(m.artworkUrl).toContain("abc"); // DOM art, not stale session art
  });
  it("uses mediaSession when DOM missing; paused state", () => {
    document.body.innerHTML = "<video></video>";
    setVideo({ paused: true });
    setMediaSession({ title: "MS Song", artist: "MS Art", album: "MS Alb", artwork: [{ src: "https://lh3.googleusercontent.com/s=w96-h96", sizes: "96x96" }, { src: "https://lh3.googleusercontent.com/b=w512-h512", sizes: "512x512" }] });
    const m = p.read(env("https://music.youtube.com/"))!;
    expect(m).toMatchObject({ title: "MS Song", creator: "MS Art", album: "MS Alb", playbackState: "paused" });
    expect(m.artworkUrl).toContain("/b=");
  });
  it("null when nothing known", () => {
    expect(p.read(env("https://music.youtube.com/"))).toBeNull();
  });
});

describe("MediaMonitor", () => {
  const url = `https://www.youtube.com/watch?v=${ID}`;
  function mk() {
    let t = 1000;
    const emits: any[] = [];
    const provider = new YouTubeProvider();
    const mon = new MediaMonitor({ doc: document, getUrl: () => new URL(url), provider, emit: (m) => emits.push(m), now: () => t, setTimer: () => 0 });
    return { mon, emits, advance: (ms: number) => (t += ms) };
  }
  it("emits on first read, dedupes, emits on pause, seek, title change, and clear", () => {
    ytPage("A", "C");
    const { mon, emits, advance } = mk();
    mon.evaluate(); expect(emits.length).toBe(1);
    advance(1000); setVideo({ currentTime: 11 }); mon.evaluate(); expect(emits.length).toBe(1); // normal progress
    advance(1000); setVideo({ currentTime: 100 }); mon.evaluate(); expect(emits.length).toBe(2); // seek
    advance(1000); setVideo({ currentTime: 101, paused: true }); mon.evaluate(); expect(emits.length).toBe(3);
    ytPage("B", "C"); setVideo({ paused: true, currentTime: 101 }); advance(10); mon.evaluate(); expect(emits.length).toBe(4);
    expect(emits[3].title).toBe("B");
    document.body.innerHTML = ""; mon.evaluate(); expect(emits[4]).toBeNull();
    mon.evaluate(); expect(emits.length).toBe(5); // no repeated nulls
  });
  it("heartbeat while idle-playing", () => {
    ytPage("A", "C");
    const { mon, emits, advance } = mk();
    mon.evaluate();
    advance(16_000); setVideo({ currentTime: 26 }); mon.evaluate();
    expect(emits.length).toBe(2);
  });
  it("provider exceptions do not propagate", () => {
    const emits: any[] = [];
    const mon = new MediaMonitor({ doc: document, getUrl: () => new URL(url), provider: { source: "youtube", matches: () => true, read: () => { throw new Error("boom"); } }, emit: (m) => emits.push(m), setTimer: () => 0 });
    expect(() => mon.evaluate()).not.toThrow();
    expect(emits).toEqual([]);
  });
  it("event listeners trigger scheduling", () => {
    ytPage("A", "C");
    const timers: Array<() => void> = [];
    const emits: any[] = [];
    const mon = new MediaMonitor({ doc: document, getUrl: () => new URL(url), provider: new YouTubeProvider(), emit: (m) => emits.push(m), setTimer: (cb) => (timers.push(cb), 0) });
    mon.start();
    timers.shift()!(); expect(emits.length).toBe(1);
    setVideo({ paused: true });
    document.querySelector("video")!.dispatchEvent(new Event("pause"));
    timers.shift()!(); expect(emits.at(-1).playbackState).toBe("paused");
    mon.stop(); expect(emits.at(-1)).toBeNull();
  });
});
void vi;

describe("choosing the right <video> (regression: 'paused' while playing after clicking from the home page)", () => {
  const ID2 = "dQw4w9WgXcQ";
  function mkVideo(parentSelector: string | null, o: { paused: boolean; duration?: number }) {
    const v = document.createElement("video");
    v.className = "video-stream html5-main-video";
    Object.defineProperty(v, "paused", { value: o.paused, configurable: true });
    Object.defineProperty(v, "ended", { value: false, configurable: true });
    Object.defineProperty(v, "duration", { value: o.duration ?? 200, configurable: true });
    Object.defineProperty(v, "currentTime", { value: 12, configurable: true });
    Object.defineProperty(v, "readyState", { value: 4, configurable: true });
    return v;
  }
  /** Mirrors YouTube after navigating home -> watch: masthead ad player (first, paused), real player, hover preview. */
  function homeThenWatchDom(mainPaused: boolean) {
    document.title = "Some Video - YouTube";
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="${ID2}"></ytd-watch-flexy>
      <ytd-video-masthead-ad-primary-video-renderer><div id="masthead-player"></div></ytd-video-masthead-ad-primary-video-renderer>
      <ytd-player><div id="movie_player" class="html5-video-player"></div></ytd-player>
      <ytd-video-preview><div id="inline-preview-player"></div></ytd-video-preview>
      <ytd-watch-metadata><h1><yt-formatted-string>Some Video</yt-formatted-string></h1><ytd-channel-name><div id="text"><a>Chan</a></div></ytd-channel-name></ytd-watch-metadata>`;
    document.querySelector("#masthead-player")!.appendChild(mkVideo(null, { paused: true, duration: NaN }));
    document.querySelector("#movie_player")!.appendChild(mkVideo(null, { paused: mainPaused }));
    document.querySelector("#inline-preview-player")!.appendChild(mkVideo(null, { paused: true, duration: NaN }));
  }
  const yt = new YouTubeProvider();
  it("reports the real player (playing), not the paused masthead/preview players that come first in the page", () => {
    homeThenWatchDom(false);
    expect(yt.read(env(`https://www.youtube.com/watch?v=${ID2}`))!.playbackState).toBe("playing");
  });
  it("still reports paused when the real player is paused", () => {
    homeThenWatchDom(true);
    expect(yt.read(env(`https://www.youtube.com/watch?v=${ID2}`))!.playbackState).toBe("paused");
  });
  it("if only the excluded players exist it falls back instead of failing", () => {
    document.body.innerHTML = `<ytd-video-preview><div id="inline-preview-player"></div></ytd-video-preview>`;
    document.querySelector("#inline-preview-player")!.appendChild(mkVideo(null, { paused: true }));
    expect(pickVideo(document)).not.toBeNull();
  });
  it("Shorts: uses the active Short's video, not a neighbouring one", () => {
    document.title = "A Short - YouTube";
    document.body.innerHTML = `<ytd-reel-video-renderer id="prev"></ytd-reel-video-renderer>
      <ytd-reel-video-renderer is-active id="cur"><h2>A Short</h2></ytd-reel-video-renderer><ytd-reel-video-renderer id="next"></ytd-reel-video-renderer>`;
    for (const [id, paused] of [["prev", true], ["cur", false], ["next", true]] as const) document.querySelector("#" + id)!.appendChild(mkVideo(null, { paused, duration: 30 }));
    expect(yt.read(env(`https://www.youtube.com/shorts/${ID2}`))!.playbackState).toBe("playing");
  });
});
