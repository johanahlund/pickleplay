/**
 * Migration script: Create default "Open" EventClass for all existing events
 * and link existing players, pairs, and matches to the class.
 *
 * Run with: npx tsx scripts/migrate-classes.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const events = await prisma.event.findMany({
    include: { classes: true },
  });

  for (const event of events) {
    // Skip if already has classes
    if (event.classes.length > 0) {
      console.log(`Event ${event.id} already has ${event.classes.length} class(es), skipping`);
      continue;
    }

    // Create default "Open" class
    const cls = await prisma.eventClass.create({
      data: {
        eventId: event.id,
        name: "Open",
        isDefault: true,
        format: "doubles",
        gender: "open",
        ageGroup: "open",
      },
    });

    // Link existing players to the class
    await prisma.eventPlayer.updateMany({
      where: { eventId: event.id, classId: null },
      data: { classId: cls.id },
    });

    // Link existing pairs to the class
    await prisma.eventPair.updateMany({
      where: { eventId: event.id, classId: null },
      data: { classId: cls.id },
    });

    // Link existing matches to the class
    await prisma.match.updateMany({
      where: { eventId: event.id, classId: null },
      data: { classId: cls.id },
    });

    console.log(`Event ${event.id} (${event.name}): created Open class ${cls.id}`);
  }

  console.log("Migration complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
