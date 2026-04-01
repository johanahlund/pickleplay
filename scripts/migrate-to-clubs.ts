/**
 * Migration script: Creates a default club and adds all existing players as members.
 * Links all existing events and WhatsApp groups to the default club.
 *
 * Run with: npx tsx scripts/migrate-to-clubs.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find the admin user to be club owner
  const admin = await prisma.player.findFirst({
    where: { role: "admin", status: "active" },
  });

  if (!admin) {
    console.log("No admin user found. Creating club without owner.");
  }

  // Check if a club already exists
  const existingClub = await prisma.club.findFirst();
  if (existingClub) {
    console.log(`Club already exists: "${existingClub.name}" (${existingClub.id}). Skipping.`);
    return;
  }

  // Create default club
  const club = await prisma.club.create({
    data: {
      name: "PickleJ",
      emoji: "🏓",
      createdById: admin?.id || null,
    },
  });
  console.log(`Created club: "${club.name}" (${club.id})`);

  // Add all active players as members
  const players = await prisma.player.findMany({
    where: { status: "active" },
  });

  for (const player of players) {
    await prisma.clubMember.create({
      data: {
        clubId: club.id,
        playerId: player.id,
        role: player.role === "admin" ? "admin" : "member",
      },
    });
  }
  console.log(`Added ${players.length} players as club members`);

  // If admin exists, make them owner
  if (admin) {
    await prisma.clubMember.update({
      where: { clubId_playerId: { clubId: club.id, playerId: admin.id } },
      data: { role: "owner" },
    });
    console.log(`Set ${admin.name} as club owner`);
  }

  // Link all events to this club
  const eventResult = await prisma.event.updateMany({
    where: { clubId: null },
    data: { clubId: club.id },
  });
  console.log(`Linked ${eventResult.count} events to club`);

  // Link all WhatsApp groups to this club
  const waResult = await prisma.whatsAppGroup.updateMany({
    where: { clubId: null },
    data: { clubId: club.id },
  });
  console.log(`Linked ${waResult.count} WhatsApp groups to club`);

  console.log("Migration complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
