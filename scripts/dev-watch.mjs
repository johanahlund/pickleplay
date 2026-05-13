/**
 * Dev runner that auto-restarts `next dev` when the Prisma client is
 * regenerated (which happens any time `prisma db push`, `prisma migrate`,
 * or `prisma generate` runs). Without this, the running Node process
 * keeps the old generated client in its module cache and every API
 * route that references a new schema field 500s until manual restart.
 *
 * Watches:
 *   - node_modules/.prisma/client/index.js   (mtime changes on generate)
 *   - prisma/schema.prisma                   (immediate restart on save)
 *
 * Usage: `npm run dev` (wired in package.json).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = process.env.PORT || "7001";

let child = null;
let restarting = false;
let pendingRestart = false;

function start() {
  console.log(`[dev-watch] starting next dev on :${PORT}`);
  child = spawn("npx", ["next", "dev", "-p", PORT], {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.on("exit", (code, signal) => {
    if (restarting) return;
    if (signal === "SIGINT" || signal === "SIGTERM" || code === null) return;
    console.log(`[dev-watch] next dev exited (code ${code})`);
    process.exit(code ?? 0);
  });
}

function restart(reason) {
  if (restarting) {
    pendingRestart = true;
    return;
  }
  restarting = true;
  console.log(`[dev-watch] ${reason} — restarting next dev …`);
  const onExit = () => {
    restarting = false;
    if (pendingRestart) {
      pendingRestart = false;
      restart("queued change");
      return;
    }
    start();
  };
  if (child) {
    child.once("exit", onExit);
    child.kill("SIGTERM");
    // Hard kill if it didn't exit in 3s.
    setTimeout(() => {
      if (restarting && child && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 3000);
  } else {
    onExit();
  }
}

// Watch the generated Prisma client (the file `db push` / `generate`
// regenerates). Polling at 500ms is fine — it's a single small file.
const clientPath = "node_modules/.prisma/client/index.js";
if (fs.existsSync(clientPath)) {
  fs.watchFile(clientPath, { interval: 500 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) restart("Prisma client regenerated");
  });
  console.log(`[dev-watch] watching ${clientPath}`);
} else {
  console.warn(`[dev-watch] ${clientPath} not found — run \`npx prisma generate\` once and restart.`);
}

// Also watch the schema for direct edits (covers iterative schema work
// where the user edits + immediately runs `db push` from another shell).
const schemaPath = "prisma/schema.prisma";
fs.watchFile(schemaPath, { interval: 500 }, (curr, prev) => {
  if (curr.mtimeMs !== prev.mtimeMs) restart("schema.prisma changed");
});
console.log(`[dev-watch] watching ${schemaPath}`);

// Forward Ctrl-C cleanly.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (child) child.kill(sig);
    process.exit(0);
  });
}

start();
