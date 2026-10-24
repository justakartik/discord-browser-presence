import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DiscordIpc, FrameDecoder, encodeFrame, pipePath } from "../apps/companion/src/discord/ipc";
import { NativeReader, encodeMessage } from "../apps/companion/src/messaging/native";
import { PresenceHost, toDiscordActivity } from "../apps/companion/src/services/host";
import { parseConfig } from "../apps/companion/src/services/config";
import type { HostResponse } from "../packages/shared/src";

/** A fake Discord that speaks the real IPC framing. */
function fakeDiscord() {
  const name = `jp-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const p = process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), name);
  const received: any[] = [];
  const handshakes: any[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((sock) => {
    sockets.push(sock);
    const dec = new FrameDecoder();
    sock.on("data", (c) => {
      for (const f of dec.push(c)) {
        if (f.op === 0) {
          handshakes.push(f.data);
          sock.write(encodeFrame(1, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
        } else if (f.op === 1) {
          received.push(f.data);
          sock.write(encodeFrame(1, { cmd: f.data.cmd, evt: null, nonce: f.data.nonce, data: {} }));
        }
      }
    });
    sock.on("error", () => {});
  });
  return {
    path: p, received, handshakes, sockets,
    listen: () => new Promise<void>((r) => server.listen(p, r)),
    killClients: () => sockets.splice(0).forEach((s) => s.destroy()),
    close: () => new Promise<void>((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()); }),
  };
}

const open: Array<{ close: () => Promise<void> | void }> = [];
afterEach(async () => { for (const o of open.splice(0)) await o.close(); });

const act = (o: any = {}) => ({ source: "youtube", type: 3, details: "T", state: "S", ...o });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("framing", () => {
  it("native messages roundtrip across split/coalesced chunks and enforce size limit", () => {
    const r = new NativeReader();
    const a = encodeMessage({ v: 1, type: "ping" });
    const b = encodeMessage({ v: 1, type: "clearActivity" });
    const all = Buffer.concat([a, b]);
    expect(r.push(all.subarray(0, 3))).toEqual([]);
    expect(r.push(all.subarray(3))).toEqual([{ v: 1, type: "ping" }, { v: 1, type: "clearActivity" }]);
    const big = Buffer.alloc(4); big.writeUInt32LE(10 * 1024 * 1024);
    expect(() => new NativeReader().push(big)).toThrow(/too large/);
    const bad = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from("{{{")]);
    expect(new NativeReader().push(bad)).toEqual([undefined]);
  });
  it("discord frames decode partial reads and reject absurd lengths", () => {
    const d = new FrameDecoder();
    const f = encodeFrame(1, { a: 1 });
    expect(d.push(f.subarray(0, 5))).toEqual([]);
    expect(d.push(f.subarray(5))).toEqual([{ op: 1, data: { a: 1 } }]);
    const evil = Buffer.alloc(8); evil.writeInt32LE(1, 0); evil.writeInt32LE(2_000_000_000, 4);
    expect(() => new FrameDecoder().push(evil)).toThrow();
  });
  it("pipe paths", () => {
    expect(pipePath(0, "win32")).toBe("\\\\?\\pipe\\discord-ipc-0");
    expect(pipePath(3, "linux", { XDG_RUNTIME_DIR: "/run/u" } as any)).toBe("/run/u/discord-ipc-3");
  });
});

describe("DiscordIpc against fake Discord", () => {
  it("handshakes with client id and sets / clears activity", async () => {
    const fd = fakeDiscord(); open.push(fd); await fd.listen();
    const c = new DiscordIpc({ clientId: "123456789012345678", paths: [fd.path] });
    open.push({ close: () => c.close() });
    await c.connect();
    expect(fd.handshakes[0]).toEqual({ v: 1, client_id: "123456789012345678" });
    await c.setActivity({ details: "x" });
    await c.setActivity(null);
    expect(fd.received[0].cmd).toBe("SET_ACTIVITY");
    expect(fd.received[0].args.activity).toEqual({ details: "x" });
    expect(fd.received[1].args.activity).toBeUndefined();
  });
  it("fails clearly when Discord is not running", async () => {
    const c = new DiscordIpc({ clientId: "1", paths: [process.platform === "win32" ? "\\\\.\\pipe\\jp-nope-xyz" : "/tmp/jp-nope-xyz"] });
    await expect(c.connect()).rejects.toThrow();
  });
});

function makeHost(fd: ReturnType<typeof fakeDiscord>, ids = { youtube: "111111111111111111", youtubeMusic: "222222222222222222" }) {
  const out: HostResponse[] = [];
  const clientIds: string[] = [];
  const host = new PresenceHost({
    config: { clientIds: ids }, version: "t", send: (r) => out.push(r),
    createClient: (id) => { clientIds.push(id); return new DiscordIpc({ clientId: id, paths: [fd.path] }); },
    backoff: [30],
  });
  open.push({ close: () => host.shutdown() });
  return { host, out, clientIds };
}

describe("PresenceHost (companion) with fake Discord", () => {
  it("rejects invalid messages without crashing", async () => {
    const fd = fakeDiscord(); open.push(fd); await fd.listen();
    const { host, out } = makeHost(fd);
    host.handle({ v: 1, type: "evil" }); host.handle(undefined); host.handle("str");
    expect(out.filter((o) => o.type === "status" && o.error?.includes("invalid")).length).toBe(3);
    expect(fd.handshakes.length).toBe(0);
  });
  it("hello reports configured flag; ping->pong", () => {
    const fd = fakeDiscord();
    const { host, out } = makeHost(fd, {} as any);
    host.handle({ v: 1, type: "hello", extensionVersion: "1" }); host.handle({ v: 1, type: "ping" });
    expect(out[0]).toMatchObject({ type: "hello", configured: false });
    expect(out.some((o) => o.type === "pong")).toBe(true);
  });
  it("publishes, dedupes, switches app per source, clears", async () => {
    const fd = fakeDiscord(); open.push(fd); await fd.listen();
    const { host, clientIds } = makeHost(fd);
    host.handle({ v: 1, type: "setActivity", activity: act() });
    await wait(150);
    expect(fd.handshakes[0].client_id).toBe("111111111111111111");
    expect(fd.received.length).toBe(1);
    expect(fd.received[0].args.activity.type).toBe(3);
    host.handle({ v: 1, type: "setActivity", activity: act() }); // duplicate
    await wait(80);
    expect(fd.received.length).toBe(1);
    host.handle({ v: 1, type: "setActivity", activity: act({ source: "youtube-music", type: 2, details: "Song" }) });
    await wait(200);
    expect(clientIds).toEqual(["111111111111111111", "222222222222222222"]);
    expect(fd.received.at(-1).args.activity.details).toBe("Song");
    host.handle({ v: 1, type: "clearActivity" });
    await wait(100);
    expect(fd.received.at(-1).args.activity).toBeUndefined();
  });
  it("reconnects after Discord restart and re-applies activity", async () => {
    const fd = fakeDiscord(); open.push(fd); await fd.listen();
    const { host } = makeHost(fd);
    host.handle({ v: 1, type: "setActivity", activity: act({ details: "Keep me" }) });
    await wait(150);
    fd.killClients();
    await wait(500);
    expect(fd.handshakes.length).toBeGreaterThanOrEqual(2);
    expect(fd.received.at(-1).args.activity.details).toBe("Keep me");
  });
  it("recovers when Discord starts after the request", async () => {
    const fd = fakeDiscord(); open.push(fd);
    const { host, out } = makeHost(fd);
    host.handle({ v: 1, type: "setActivity", activity: act({ details: "Late" }) });
    await wait(100);
    expect(out.some((o) => o.type === "status" && o.error)).toBe(true);
    await fd.listen();
    await wait(400);
    expect(fd.received.at(-1)?.args.activity.details).toBe("Late");
  });
  it("shutdown clears presence", async () => {
    const fd = fakeDiscord(); open.push(fd); await fd.listen();
    const { host } = makeHost(fd);
    host.handle({ v: 1, type: "setActivity", activity: act() });
    await wait(150);
    await host.shutdown();
    expect(fd.received.at(-1).args.activity).toBeUndefined();
  });
  it("reports missing client id", async () => {
    const fd = fakeDiscord();
    const { host, out } = makeHost(fd, {} as any);
    host.handle({ v: 1, type: "setActivity", activity: act() });
    await wait(20);
    expect(out.at(-1)).toMatchObject({ type: "status", error: expect.stringContaining("client ID") });
  });
});

describe("mapping/config", () => {
  it("maps activity to Discord shape", () => {
    expect(toDiscordActivity({ source: "youtube", type: 3, details: "d", startMs: 1, endMs: 5, largeImage: "https://i.ytimg.com/a.jpg", largeText: "YouTube" } as any))
      .toMatchObject({ type: 3, details: "d", timestamps: { start: 1, end: 5 }, assets: { large_image: "https://i.ytimg.com/a.jpg", large_text: "YouTube" } });
  });
  it("adds play/pause badge keys and keeps large image fallback", () => {
    const playing: any = toDiscordActivity({ source: "youtube", type: 3, details: "d" } as any);
    expect(playing.assets).toEqual({ large_image: "logo", small_image: "play", small_text: "Playing" });
    const paused: any = toDiscordActivity({ source: "youtube", type: 3, details: "d", paused: true, largeImage: "https://i.ytimg.com/a.jpg" } as any);
    expect(paused.assets).toMatchObject({ large_image: "https://i.ytimg.com/a.jpg", small_image: "pause", small_text: "Paused" });
  });
  it("adds Listen/Watch Along + GitHub buttons only when a media url exists", () => {
    const m: any = toDiscordActivity({ source: "youtube-music", type: 2, details: "d", url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" } as any);
    expect(m.buttons).toEqual([
      { label: "Listen Along", url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" },
      { label: "GitHub", url: "https://github.com/justakartik/discord-browser-presence" },
    ]);
    const y: any = toDiscordActivity({ source: "youtube", type: 3, details: "d", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } as any);
    expect(y.buttons[0].label).toBe("Watch Along");
    expect((toDiscordActivity({ source: "youtube", type: 3, details: "d" } as any) as any).buttons).toBeUndefined();
  });
  it("parseConfig only accepts snowflake-like ids", () => {
    expect(parseConfig({ clientIds: { youtube: "abc", youtubeMusic: "123456789012345678" } })).toEqual({ clientIds: { youtube: undefined, youtubeMusic: "123456789012345678" } });
  });
});
