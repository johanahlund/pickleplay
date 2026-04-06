/**
 * Rating system: Club ratings + Global ratings + Club offset estimation
 *
 * Club rating: tracks performance within a single club
 * Global rating: tracks performance in cross-club matches
 * Estimated global: club rating + club's ratingOffset (for players without direct global rating)
 */

import { prisma } from "./db";

const K = 32; // ELO K-factor

function eloChange(winnerRating: number, loserRating: number): number {
  const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  return Math.round(K * (1 - expected));
}

/**
 * After a match is scored, update all three rating types.
 * Called from the score submission API.
 */
export async function updateRatings(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: { include: { player: true } },
      event: { select: { id: true, clubId: true } },
    },
  });

  if (!match || !match.event) return { change: 0, isCrossClub: false };

  const team1 = match.players.filter((p) => p.team === 1);
  const team2 = match.players.filter((p) => p.team === 2);
  const t1Score = team1[0]?.score ?? 0;
  const t2Score = team2[0]?.score ?? 0;
  if (t1Score === t2Score) return { change: 0, isCrossClub: false };

  const winners = t1Score > t2Score ? team1 : team2;
  const losers = t1Score > t2Score ? team2 : team1;

  // Detect cross-club match
  const playerClubs = new Map<string, string[]>();
  for (const mp of match.players) {
    const memberships = await prisma.clubMember.findMany({
      where: { playerId: mp.playerId },
      select: { clubId: true },
    });
    playerClubs.set(mp.playerId, memberships.map((m) => m.clubId));
  }

  const allClubIds = new Set<string>();
  for (const clubs of playerClubs.values()) {
    clubs.forEach((c) => allClubIds.add(c));
  }
  const isCrossClub = allClubIds.size > 1;

  // Mark match as cross-club
  if (isCrossClub) {
    await prisma.match.update({ where: { id: matchId }, data: { isCrossClub: true } });
  }

  // Calculate ELO change based on legacy ratings
  const winnerAvgRating = winners.reduce((s, p) => s + p.player.rating, 0) / winners.length;
  const loserAvgRating = losers.reduce((s, p) => s + p.player.rating, 0) / losers.length;
  const change = eloChange(winnerAvgRating, loserAvgRating);

  // Update legacy rating (always)
  for (const mp of winners) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: { rating: { increment: change }, wins: { increment: 1 } },
    });
  }
  for (const mp of losers) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: { rating: { decrement: change }, losses: { increment: 1 } },
    });
  }

  // Update club ratings (if event belongs to a club)
  if (match.event.clubId) {
    for (const mp of winners) {
      await upsertClubRating(match.event.clubId, mp.playerId, change, true);
    }
    for (const mp of losers) {
      await upsertClubRating(match.event.clubId, mp.playerId, -change, false);
    }
  }

  // Update global ratings (only for cross-club matches)
  if (isCrossClub) {
    for (const mp of winners) {
      const player = mp.player;
      const currentGlobal = player.globalRating ?? 1000;
      await prisma.player.update({
        where: { id: mp.playerId },
        data: {
          globalRating: currentGlobal + change,
          globalRatingConfidence: { increment: 1 },
          globalWins: { increment: 1 },
        },
      });
    }
    for (const mp of losers) {
      const player = mp.player;
      const currentGlobal = player.globalRating ?? 1000;
      await prisma.player.update({
        where: { id: mp.playerId },
        data: {
          globalRating: currentGlobal - change,
          globalRatingConfidence: { increment: 1 },
          globalLosses: { increment: 1 },
        },
      });
    }

    // Recalculate club offsets for affected clubs
    for (const clubId of allClubIds) {
      await recalculateClubOffset(clubId);
    }
  }

  // Store ELO change on match
  await prisma.match.update({
    where: { id: matchId },
    data: { eloChange: change, scoreConfirmed: true },
  });

  return { change, isCrossClub };
}

async function upsertClubRating(clubId: string, playerId: string, ratingChange: number, isWin: boolean) {
  const existing = await prisma.clubPlayerRating.findUnique({
    where: { clubId_playerId: { clubId, playerId } },
  });

  if (existing) {
    await prisma.clubPlayerRating.update({
      where: { id: existing.id },
      data: {
        rating: { increment: ratingChange },
        ...(isWin ? { wins: { increment: 1 } } : { losses: { increment: 1 } }),
      },
    });
  } else {
    await prisma.clubPlayerRating.create({
      data: {
        clubId,
        playerId,
        rating: 1000 + ratingChange,
        wins: isWin ? 1 : 0,
        losses: isWin ? 0 : 1,
      },
    });
  }
}

/**
 * Recalculate a club's rating offset based on players who have global ratings.
 * offset = average(player.globalRating - clubRating) for all bridge players
 */
async function recalculateClubOffset(clubId: string) {
  const clubRatings = await prisma.clubPlayerRating.findMany({
    where: { clubId },
    include: { player: { select: { globalRating: true, globalRatingConfidence: true } } },
  });

  const bridgePlayers = clubRatings.filter((cr) => cr.player.globalRating !== null && (cr.player.globalRatingConfidence ?? 0) > 0);

  if (bridgePlayers.length === 0) {
    await prisma.club.update({
      where: { id: clubId },
      data: { ratingOffset: null, ratingBridgePlayers: 0 },
    });
    return;
  }

  const totalOffset = bridgePlayers.reduce((sum, cr) => {
    return sum + ((cr.player.globalRating ?? 1000) - cr.rating);
  }, 0);

  const avgOffset = totalOffset / bridgePlayers.length;

  await prisma.club.update({
    where: { id: clubId },
    data: { ratingOffset: avgOffset, ratingBridgePlayers: bridgePlayers.length },
  });
}

/**
 * Get a player's estimated global rating for a specific club.
 * If they have a direct global rating, use that.
 * Otherwise, use clubRating + club's offset.
 */
export function estimateGlobalRating(
  playerGlobalRating: number | null,
  playerGlobalConfidence: number,
  clubRating: number,
  clubOffset: number | null
): { rating: number | null; isEstimate: boolean; confidence: string } {
  // Direct global rating
  if (playerGlobalRating !== null && playerGlobalConfidence >= 4) {
    return { rating: playerGlobalRating, isEstimate: false, confidence: "high" };
  }
  if (playerGlobalRating !== null && playerGlobalConfidence > 0) {
    return { rating: playerGlobalRating, isEstimate: false, confidence: playerGlobalConfidence >= 2 ? "medium" : "low" };
  }

  // Estimated from club offset
  if (clubOffset !== null) {
    return { rating: Math.round(clubRating + clubOffset), isEstimate: true, confidence: "estimated" };
  }

  return { rating: null, isEstimate: true, confidence: "none" };
}
