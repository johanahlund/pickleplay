/**
 * One-off status remap so existing rows match the simplified taxonomy.
 *
 *   Event:  visible|draft → setup,  completed → active
 *   League: registration → open,    forming   → closed
 *
 * Run with: npx tsx scripts/migrate-statuses.ts
 *
 * Safe to re-run — each UPDATE is idempotent.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const eVisible = await prisma.event.updateMany({ where: { status: "visible" }, data: { status: "setup" } });
  const eDraft   = await prisma.event.updateMany({ where: { status: "draft"   }, data: { status: "setup" } });
  const eDone    = await prisma.event.updateMany({ where: { status: "completed" }, data: { status: "active" } });
  const lReg     = await prisma.league.updateMany({ where: { status: "registration" }, data: { status: "open" } });
  const lForm    = await prisma.league.updateMany({ where: { status: "forming"      }, data: { status: "closed" } });

  console.log("Event status remap:");
  console.log(`  visible   → setup:  ${eVisible.count}`);
  console.log(`  draft     → setup:  ${eDraft.count}`);
  console.log(`  completed → active: ${eDone.count}`);
  console.log("League status remap:");
  console.log(`  registration → open:   ${lReg.count}`);
  console.log(`  forming      → closed: ${lForm.count}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
