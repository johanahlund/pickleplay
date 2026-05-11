/**
 * One-off migration: the Event.status field used to carry an "active"
 * value that meant "lineups revealed / event running" — two concepts
 * mashed into one field. The new model handles those derived from
 * lineupTotalLocked + date window, so "active" goes away as a stored
 * status. Anything currently set to "active" becomes "closed" (closest
 * semantic — registration is locked, event is past the open phase).
 *
 * Run with: npx tsx scripts/migrate-event-status.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // "active" → "closed".
  const r1 = await prisma.event.updateMany({
    where: { status: "active" },
    data: { status: "closed" },
  });
  console.log(`Updated ${r1.count} events: active → closed`);

  // Legacy aliases that still showed up in earlier data: "visible" /
  // "draft" both meant a setup-stage event. Map them to "setup" so the
  // new visibility rule treats them consistently.
  const r2 = await prisma.event.updateMany({
    where: { status: { in: ["visible", "draft"] } },
    data: { status: "setup" },
  });
  console.log(`Updated ${r2.count} events: visible/draft → setup`);

  // "completed" was used in some flows for past events; status doesn't
  // need to track "ran in the past" — that's derived from dates now.
  // Map to "closed" so the post-event view still makes sense.
  const r3 = await prisma.event.updateMany({
    where: { status: "completed" },
    data: { status: "closed" },
  });
  console.log(`Updated ${r3.count} events: completed → closed`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
