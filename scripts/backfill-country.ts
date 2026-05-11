/**
 * One-off backfill: set country="Portugal" on every Player row that
 * currently has no country.
 *
 * Run with: npx tsx scripts/backfill-country.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const r = await prisma.player.updateMany({
    where: { country: null },
    data: { country: "Portugal" },
  });
  console.log(`Updated ${r.count} players to country=Portugal`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
