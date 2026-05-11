/**
 * One-shot: flip every STANDALONE event currently in "setup" status to
 * "open" so existing data matches the new default (set by
 * `POST /api/events` after we discovered the old "setup" default was
 * silently hiding events from normal users).
 *
 * League-attached events (those with `roundId`) are intentionally left
 * alone — they should stay in "setup" until the league admin publishes
 * the round (which already flips them to "open" via the round PATCH
 * cascade).
 *
 * Run with:  npx tsx scripts/open-setup-events.ts
 */
import { prisma } from "../src/lib/db";

async function main() {
  const candidates = await prisma.event.findMany({
    where: {
      status: { in: ["setup", "draft", "visible"] },
      roundId: null,
    },
    select: { id: true, name: true, status: true, createdAt: true },
  });
  if (candidates.length === 0) {
    console.log("Nothing to migrate — no standalone events in setup/draft/visible.");
    return;
  }
  console.log(`Found ${candidates.length} standalone event(s) to flip to open:`);
  for (const c of candidates) {
    console.log(`  - [${c.status}] ${c.name} (${c.id}, created ${c.createdAt.toISOString().slice(0, 10)})`);
  }
  const result = await prisma.event.updateMany({
    where: {
      status: { in: ["setup", "draft", "visible"] },
      roundId: null,
    },
    data: { status: "open" },
  });
  console.log(`Updated ${result.count} event(s) → status: "open".`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
