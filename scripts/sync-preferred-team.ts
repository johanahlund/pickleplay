/**
 * Backfill: set LeagueParticipationRequest.preferredTeamId to the team the
 * player is actually on, for every accepted request where preferredTeamId
 * doesn't match the player's roster team. Idempotent.
 *
 * Run with: npx tsx scripts/sync-preferred-team.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const accepted = await prisma.leagueParticipationRequest.findMany({
    where: { status: "accepted" },
    select: { id: true, leagueId: true, playerId: true, preferredTeamId: true },
  });

  let updated = 0, skipped = 0, missing = 0;
  for (const r of accepted) {
    const ltp = await prisma.leagueTeamPlayer.findFirst({
      where: { playerId: r.playerId, team: { leagueId: r.leagueId } },
      select: { teamId: true },
    });
    if (!ltp) { missing++; continue; }
    if (ltp.teamId === r.preferredTeamId) { skipped++; continue; }
    await prisma.leagueParticipationRequest.update({
      where: { id: r.id },
      data: { preferredTeamId: ltp.teamId },
    });
    updated++;
  }
  console.log(`accepted: ${accepted.length}  updated: ${updated}  already-aligned: ${skipped}  not-on-team: ${missing}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
