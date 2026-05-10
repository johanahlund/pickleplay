/**
 * Full sync: every LeagueTeamPlayer row should have a corresponding
 * LeagueParticipationRequest with status="accepted" and
 * preferredTeamId === teamId. Creates missing rows; updates mismatched
 * preferredTeamId. Idempotent.
 *
 * Run with: npx tsx scripts/sync-preferred-team-full.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ltps = await prisma.leagueTeamPlayer.findMany({
    select: { id: true, playerId: true, teamId: true, team: { select: { leagueId: true } } },
  });

  let created = 0, updated = 0, aligned = 0;
  for (const tp of ltps) {
    const leagueId = tp.team.leagueId;
    const existing = await prisma.leagueParticipationRequest.findUnique({
      where: { leagueId_playerId: { leagueId, playerId: tp.playerId } },
    });
    if (!existing) {
      await prisma.leagueParticipationRequest.create({
        data: {
          leagueId, playerId: tp.playerId,
          preferredTeamId: tp.teamId,
          status: "accepted",
          respondedAt: new Date(),
        },
      });
      created++;
      continue;
    }
    if (existing.preferredTeamId === tp.teamId && existing.status === "accepted") {
      aligned++;
      continue;
    }
    await prisma.leagueParticipationRequest.update({
      where: { id: existing.id },
      data: { preferredTeamId: tp.teamId, status: "accepted" },
    });
    updated++;
  }
  console.log(`team-players: ${ltps.length}  created: ${created}  updated: ${updated}  already-aligned: ${aligned}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
