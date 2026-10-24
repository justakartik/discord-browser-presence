import type { ActivityPayload, HostResponse } from "@jpresence/shared";
import { validateHostRequest } from "@jpresence/shared";
import type { DiscordLike } from "../discord/ipc";

export type CompanionConfig = { clientIds: { youtube?: string; youtubeMusic?: string; web?: string } };

export type HostOptions = {
  config: CompanionConfig;
  version: string;
  send: (r: HostResponse) => void;
  createClient: (clientId: string) => DiscordLike;
  /** backoff in ms, indexed by attempt (last repeats) */
  backoff?: number[];
  now?: () => number;
  /** Diagnostics hook: the exact payload sent and Discord's reply. */
  onSent?: (payload: Record<string, unknown>, response: unknown) => void;
};

export const GITHUB_URL = "https://github.com/justakartik/discord-browser-presence";

export function toDiscordActivity(a: ActivityPayload): Record<string, unknown> {
  const act: Record<string, unknown> = {
    type: a.type,
    details: a.details,
    status_display_type: 2,
  };
  if (a.name) act.name = a.name; // honoured by Discord: lets one app show "WhatsApp", "Instagram", ...
  if (a.state) act.state = a.state;
  if (a.startMs !== undefined) {
    act.timestamps = { start: a.startMs, ...(a.endMs !== undefined ? { end: a.endMs } : {}) };
  }
  // Large image falls back to asset key "logo"; small badge keys "play"/"pause" must be
  // uploaded to the Discord application (Rich Presence -> Art Assets).
  act.assets = {
    large_image: a.largeImage ?? "logo",
    ...(a.largeText ? { large_text: a.largeText } : {}),
    ...(a.noBadge
      ? {}
      : { small_image: a.paused ? "pause" : "play", small_text: a.paused ? "Paused" : "Playing" }),
  };
  if (a.url) {
    act.details_url = a.url;
    // Buttons are visible to other Discord users (not to yourself). Max 2.
    act.buttons = [
      { label: a.source === "youtube-music" ? "Listen Along" : "Watch Along", url: a.url },
      { label: "GitHub", url: GITHUB_URL },
    ];
  }
  return act;
}

export class PresenceHost {
  private client: DiscordLike | null = null;
  private clientSource: string | null = null;
  private wanted: ActivityPayload | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdate: number | undefined;
  private lastError: string | undefined;
  private state: "connected" | "connecting" | "disconnected" = "disconnected";
  private lastSent = "";
  private closed = false;

  constructor(private o: HostOptions) {}

  private clientIdFor(source: string): string | undefined {
    const c = this.o.config.clientIds;
    // Websites reuse the YouTube application by default (the activity name is overridden per site),
    // so switching between YouTube and a website needs no reconnect.
    if (source === "web") return c.web ?? c.youtube ?? c.youtubeMusic;
    return (source === "youtube-music" ? c.youtubeMusic : c.youtube) ?? c.youtube ?? c.youtubeMusic;
  }

  private status(error?: string) {
    if (error) this.lastError = error;
    this.o.send({
      v: 1,
      type: "status",
      discord: this.state,
      lastUpdate: this.lastUpdate,
      error: this.lastError,
    });
  }

  handle(raw: unknown): void {
    const req = validateHostRequest(raw);
    if (!req) return this.status("Rejected invalid message");
    switch (req.type) {
      case "ping":
        this.o.send({ v: 1, type: "pong" });
        return;
      case "hello": {
        const c = this.o.config.clientIds;
        this.o.send({
          v: 1,
          type: "hello",
          companionVersion: this.o.version,
          configured: Boolean(c.youtube || c.youtubeMusic),
        });
        this.status();
        return;
      }
      case "clearActivity":
        this.wanted = null;
        void this.apply();
        return;
      case "setActivity":
        this.wanted = req.activity;
        void this.apply();
        return;
    }
  }

  private async apply(): Promise<void> {
    if (this.closed) return;
    const want = this.wanted;
    if (!want) {
      this.lastSent = "";
      if (this.client?.ready) {
        try {
          await this.client.setActivity(null);
          this.lastUpdate = (this.o.now ?? Date.now)();
        } catch (e) {
          this.lastError = (e as Error).message;
        }
      }
      this.status();
      return;
    }
    const clientId = this.clientIdFor(want.source);
    if (!clientId) {
      this.status("No Discord application client ID configured (see docs/INSTALLATION.md)");
      return;
    }
    // Switch client when the Discord application identity changes.
    if (this.client && this.clientSource !== clientId) {
      this.dropClient();
    }
    if (!this.client?.ready) {
      await this.connect(clientId);
      return;
    }
    const payload = toDiscordActivity(want);
    const key = JSON.stringify(payload);
    if (key === this.lastSent) return;
    try {
      const response = await this.client.setActivity(payload);
      this.o.onSent?.(payload, response);
      this.lastSent = key;
      this.lastUpdate = (this.o.now ?? Date.now)();
      this.lastError = undefined;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.dropClient();
      this.scheduleReconnect();
    }
    this.status();
  }

  private dropClient() {
    const c = this.client;
    this.client = null;
    this.clientSource = null;
    this.lastSent = "";
    c?.removeAllListeners();
    c?.close();
    this.state = "disconnected";
  }

  private async connect(clientId: string): Promise<void> {
    if (this.state === "connecting") return;
    this.state = "connecting";
    this.status();
    const c = this.o.createClient(clientId);
    try {
      await c.connect();
    } catch (e) {
      c.removeAllListeners();
      this.state = "disconnected";
      this.lastError = (e as Error).message;
      this.status();
      this.scheduleReconnect();
      return;
    }
    if (this.closed) return c.close();
    this.client = c;
    this.clientSource = clientId;
    this.state = "connected";
    this.attempt = 0;
    this.lastError = undefined;
    c.on("close", () => {
      if (this.client !== c) return;
      this.dropClient();
      this.status("Discord connection closed");
      this.scheduleReconnect();
    });
    this.status();
    await this.apply();
  }

  private scheduleReconnect() {
    if (this.closed || this.timer || !this.wanted) return;
    const steps = this.o.backoff ?? [1000, 2000, 5000, 10000, 30000];
    const delay = steps[Math.min(this.attempt, steps.length - 1)]!;
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.apply();
    }, delay);
  }

  /** Clear presence and release resources. */
  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.client?.ready) {
      try {
        await this.client.setActivity(null);
      } catch {
        /* ignore */
      }
    }
    this.dropClient();
  }
}
