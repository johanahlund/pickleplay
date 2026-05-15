import { prisma } from "../src/lib/db";

async function main() {
  const result = await prisma.$executeRaw`
    UPDATE "Player"
    SET "accountActivatedAt" = "createdAt"
    WHERE "passwordHash" IS NOT NULL
      AND "accountActivatedAt" IS NULL
  `;
  console.log(`Backfilled accountActivatedAt for ${result} players.`);
}

main().finally(() => prisma.$disconnect());
