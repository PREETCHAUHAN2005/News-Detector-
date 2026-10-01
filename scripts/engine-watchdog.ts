/**
 * Veritas engine watchdog — keeps the Python NLP engine (port 8001) alive.
 *
 * Pings /healthz every 30s; on failure it re-spawns the engine (plain uvicorn,
 * no --reload watcher) and waits (up to 60s) for warmup. Engine stdout/stderr
 * are captured to engine.log so crashes leave a trace. Run it detached:
 *
 *   setsid bun run scripts/engine-watchdog.ts >> mini-services/nlp-engine/watchdog.log 2>&1 &
 */
import { openSync } from "node:fs";

const ENGINE_URL = "http://127.0.0.1:8001/healthz";
const ENGINE_DIR = new URL("../mini-services/nlp-engine", import.meta.url).pathname;
const ENGINE_LOG = new URL("../mini-services/nlp-engine/engine.log", import.meta.url).pathname;
const CHECK_INTERVAL_MS = 30_000;
const WARMUP_TIMEOUT_MS = 60_000;

// append fd for engine output — opened once, reused for every (re)spawn
const engineLogFd = openSync(ENGINE_LOG, "a");

function log(message: string): void {
  console.log(`[watchdog ${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(ENGINE_URL, { signal: AbortSignal.timeout(4_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startEngine(): Promise<number> {
  // plain uvicorn (no --reload): the file-watcher supervisor was implicated
  // in silent engine deaths; engine output goes to engine.log for traceability
  const proc = Bun.spawn(["bun", "run", "start"], {
    cwd: ENGINE_DIR,
    stdin: "ignore",
    stdout: engineLogFd,
    stderr: engineLogFd,
  });
  proc.unref();
  return proc.pid;
}

async function main(): Promise<void> {
  log(`watchdog started — monitoring ${ENGINE_URL} every ${CHECK_INTERVAL_MS / 1000}s`);
  for (;;) {
    if (!(await healthy())) {
      log("engine unhealthy — restarting");
      const pid = await startEngine();
      log(`spawned engine process (pid ${pid}) — waiting for warmup`);
      const deadline = Date.now() + WARMUP_TIMEOUT_MS;
      let up = false;
      while (Date.now() < deadline) {
        await sleep(2_000);
        if (await healthy()) {
          up = true;
          break;
        }
      }
      log(up ? "engine healthy again" : "engine still down after warmup window — will retry next cycle");
    }
    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((err) => {
  log(`fatal: ${String(err)}`);
  process.exit(1);
});
