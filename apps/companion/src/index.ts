import fs from "node:fs";
import path from "node:path";
import { attachNative } from "./messaging/native";
import { DiscordIpc } from "./discord/ipc";
import { PresenceHost } from "./services/host";
import { loadConfig } from "./services/config";
import { install, uninstall } from "./install";

const VERSION = "0.3.0";
const EXT_ID = typeof __EXT_ID__ !== "undefined" ? __EXT_ID__ : "";
const args = process.argv.slice(2);
const log = (s: string) => process.stdout.write(`${s}\n`);

function arg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function pause() {
  // Double-clicked from Explorer: keep the console open so the user can read the result.
  if (process.stdin.isTTY && process.stdout.isTTY) {
    log("\nPress any key to close...");
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(0));
  }
}

// Chrome/Edge always pass the calling extension's origin as the first argument.
const launchedByBrowser = args.some((a) => a.startsWith("chrome-extension://"));

try {
  // Startup trace (no personal data): helps diagnose how the browser launched us.
  const startupLog = path.join(path.dirname(process.execPath), "startup.log");
  if (fs.existsSync(startupLog) && fs.statSync(startupLog).size > 50_000) fs.rmSync(startupLog);
  fs.appendFileSync(
    startupLog,
    `${new Date().toISOString()} start argv=${JSON.stringify(args)} browser=${launchedByBrowser} tty=${Boolean(process.stdin.isTTY)}\n`,
  );
} catch {
  /* ignore */
}

if (launchedByBrowser) {
  runHost();
} else if (args.includes("--version")) {
  log(VERSION);
  process.exit(0);
} else if (args.includes("--uninstall")) {
  try {
    uninstall(log, args.includes("--remove-config"));
  } catch (e) {
    log(`Failed: ${(e as Error).message}`);
  }
  pause();
} else if (args.includes("--install") || process.stdin.isTTY) {
  // Run by a person (console attached) rather than by the browser (stdin is a pipe).
  try {
    install(arg("--extension-id") ?? EXT_ID, log);
    log("\nNext: load the extension (chrome://extensions -> Load unpacked), then reload it.");
  } catch (e) {
    log(`Install failed: ${(e as Error).message}`);
  }
  pause();
} else {
  runHost(); // piped stdin without an origin argument (tests, manual use)
}

function runHost() {
  // eslint-disable-next-line prefer-const -- assigned after `send` exists (mutual reference)
  let host: PresenceHost;
  const send = attachNative(
    process.stdin,
    process.stdout,
    (m) => {
      const msg = m as { type?: string; activity?: { source?: string; paused?: boolean; startMs?: number; endMs?: number } } | undefined;
      const a = msg?.type === "setActivity" ? msg.activity : undefined;
      dlog(
        `recv ${msg?.type ?? "invalid"}` +
          (a ? ` source=${a.source} paused=${a.paused === true} timer=${a.startMs !== undefined}${a.endMs !== undefined ? "+end" : ""}` : ""),
      );
      host.handle(m);
    },
    (err) => {
      dlog(`port closed${err ? `: ${err.message}` : ""}`);
      // Browser closed the port (or sent a bad frame): clear presence and exit.
      void host.shutdown().finally(() => process.exit(0));
    },
  );

  // Local diagnostics only (message types and statuses, never titles); size-capped.
  const logFile = path.join(path.dirname(process.execPath), "host.log");
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 100_000) fs.rmSync(logFile);
  } catch {
    /* ignore */
  }
  let logWrites = 0;
  function dlog(line: string) {
    try {
      // Cap the file during long sessions too, not just at startup.
      if (++logWrites % 200 === 0 && fs.statSync(logFile).size > 100_000) fs.rmSync(logFile);
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* ignore */
    }
  }
  dlog(`host started v${VERSION}`);

  host = new PresenceHost({
    config: loadConfig(),
    version: VERSION,
    send: (r) => {
      dlog(`send ${r.type}${r.type === "status" ? ` discord=${r.discord}${r.error ? ` error=${r.error}` : ""}` : ""}`);
      send(r);
    },
    onSent: (payload, response) => {
      // Local-only diagnostics: overwritten on each update, never transmitted.
      try {
        fs.writeFileSync(
          path.join(path.dirname(process.execPath), "last-activity.json"),
          JSON.stringify({ at: new Date().toISOString(), sent: payload, discordReply: response }, null, 2),
        );
      } catch {
        /* diagnostics must never break presence */
      }
    },
    createClient: (clientId) => new DiscordIpc({ clientId }),
  });

  process.on("SIGTERM", () => void host.shutdown().finally(() => process.exit(0)));
  process.on("uncaughtException", () => void host.shutdown().finally(() => process.exit(1)));
}
