import { prisma } from "@/lib/db";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// ELO rating update for doubles
function eloChange(
  winnerRating: number,
  loserRating: number,
  K = 32
): number {
  const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  return Math.round(K * (1 - expected));
}

async function applyElo(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { players: { include: { player: true } } },
  });
  if (!match) return 0;

  const team1Players = match.players.filter((mp) => mp.team === 1);
  const team2Players = match.players.filter((mp) => mp.team === 2);
  const team1Score = team1Players[0]?.score ?? 0;
  const team2Score = team2Players[0]?.score ?? 0;
  if (team1Score === team2Score) return 0;

  const team1AvgRating = team1Players.reduce((s, mp) => s + mp.player.rating, 0) / team1Players.length;
  const team2AvgRating = team2Players.reduce((s, mp) => s + mp.player.rating, 0) / team2Players.length;

  const winnerTeam = team1Score > team2Score ? 1 : 2;
  const winnerRating = winnerTeam === 1 ? team1AvgRating : team2AvgRating;
  const loserRating = winnerTeam === 1 ? team2AvgRating : team1AvgRating;
  const change = eloChange(winnerRating, loserRating);

  const winners = winnerTeam === 1 ? team1Players : team2Players;
  const losers = winnerTeam === 1 ? team2Players : team1Players;

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

  await prisma.match.update({
    where: { id: matchId },
    data: { eloChange: change, scoreConfirmed: true },
  });

  return change;
}

async function reverseElo(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { players: { include: { player: true } } },
  });
  if (!match || match.eloChange === 0) return;

  const team1Players = match.players.filter((mp) => mp.team === 1);
  const team2Players = match.players.filter((mp) => mp.team === 2);
  const team1Score = team1Players[0]?.score ?? 0;
  const team2Score = team2Players[0]?.score ?? 0;
  const winnerTeam = team1Score > team2Score ? 1 : 2;
  const winners = winnerTeam === 1 ? team1Players : team2Players;
  const losers = winnerTeam === 1 ? team2Players : team1Players;
  const change = match.eloChange;

  for (const mp of winners) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: { rating: { decrement: change }, wins: { decrement: 1 } },
    });
  }
  for (const mp of losers) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: { rating: { increment: change }, losses: { decrement: 1 } },
    });
  }
}

// POST: Submit initial score for a pending match (admin or match player)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { team1Score, team2Score } = await req.json();

  if (team1Score === undefined || team2Score === undefined) {
    return NextResponse.json({ error: "Scores required" }, { status: 400 });
  }
  if (team1Score === team2Score) {
    return NextResponse.json({ error: "Scores cannot be tied" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({
    where: { id },
    include: { players: { include: { player: true } } },
  });

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const isMatchPlayer = match.players.some((mp) => mp.playerId === user.id);
  if (user.role !== "admin" && !isMatchPlayer) {
    return NextResponse.json({ error: "Only match participants or admins can submit scores" }, { status: 403 });
  }

  // Update match player scores
  const team1Players = match.players.filter((mp) => mp.team === 1);
  const team2Players = match.players.filter((mp) => mp.team === 2);

  for (const mp of team1Players) {
    await prisma.matchPlayer.update({ where: { id: mp.id }, data: { score: team1Score } });
  }
  for (const mp of team2Players) {
    await prisma.matchPlayer.update({ where: { id: mp.id }, data: { score: team2Score } });
  }

  const winnerTeam = team1Score > team2Score ? 1 : 2;
  let change = 0;

  // Mark match as completed
  await prisma.match.update({
    where: { id },
    data: { status: "completed" },
  });

  if (match.rankingMode === "ranked") {
    // Apply ratings (club + global + legacy)
    const { updateRatings } = await import("@/lib/ratings");
    const result = await updateRatings(id);
    change = result.change;
  } else if (match.rankingMode === "approval") {
    // Score saved but ELO not applied — awaiting confirmation
    await prisma.match.update({
      where: { id },
      data: { scoreConfirmed: false },
    });
  }
  // "none" — no ELO, no confirmation needed

  // ── Post-score hooks ──
  await handlePostScore(match.id);

  return NextResponse.json({
    ok: true,
    winnerTeam,
    eloChange: change,
    rankingMode: match.rankingMode,
  });
}

/**
 * After scoring a match:
 * 1. Bracket progression — fill winner/loser into next bracket match
 * 2. Dynamic court assignment — assign freed court to next pending match
 */
async function handlePostScore(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: true,
      event: { select: { id: true, numCourts: true } },
      class: { select: { competitionMode: true, competitionConfig: true, playMode: true, pairingMode: true, format: true, prioSpeed: true, prioFairness: true, prioSkill: true } },
    },
  });
  if (!match || !match.event) return;

  // 1. Bracket progression
  if (match.bracketStage && match.bracketPosition) {
    const { getNextBracketMatch, getMatchWinnerLoser } = await import("@/lib/competition/progression");

    const prefix = match.bracketStage.startsWith("upper_") ? "upper" : "lower";
    const config = match.class?.competitionConfig as Record<string, unknown> | null;
    const hasThirdPlace = prefix === "upper"
      ? !!(config?.upperThirdPlace ?? true)
      : !!(config?.lowerThirdPlace ?? false);

    const { winnerNext, loserNext } = getNextBracketMatch(
      match.bracketStage, match.bracketPosition, prefix, hasThirdPlace
    );

    const { winnerPlayerIds, loserPlayerIds } = getMatchWinnerLoser(match.players);

    // Fill winner into next match
    if (winnerNext) {
      await fillBracketSlot(
        match.eventId, winnerNext.bracketStage, winnerNext.bracketPosition,
        winnerNext.team, winnerPlayerIds
      );
    }

    // Fill loser into 3rd place match
    if (loserNext) {
      await fillBracketSlot(
        match.eventId, loserNext.bracketStage, loserNext.bracketPosition,
        loserNext.team, loserPlayerIds
      );
    }
  }

  // 2. Dynamic court assignment — assign this court to next pending match
  const allMatches = await prisma.match.findMany({
    where: { eventId: match.eventId },
    include: { players: true },
    orderBy: [{ round: "asc" }, { courtNum: "asc" }],
  });

  const { findNextPendingMatch } = await import("@/lib/competition/progression");
  const nextMatch = findNextPendingMatch(
    allMatches.map((m) => ({
      ...m,
      players: m.players.map((p) => ({ playerId: p.playerId, team: p.team, score: p.score })),
    })),
    match.courtNum
  );

  if (nextMatch && nextMatch.courtNum !== match.courtNum) {
    await prisma.match.update({
      where: { id: nextMatch.id },
      data: { courtNum: match.courtNum },
    });
  }

  // 3. Continuous rotation — auto-generate next match if continuous mode
  if (match.class?.playMode === "continuous" && !match.bracketStage) {
    const { generateNextMatch } = await import("@/lib/rotation");
    const { getMatchWinnerLoser } = await import("@/lib/competition/progression");

    // Get all event players with match stats
    const eventPlayers = await prisma.eventPlayer.findMany({
      where: { eventId: match.eventId, status: { in: ["registered", "checked_in"] } },
      include: { player: true },
    });

    // Count matches and find last match time per player
    const playerMatchCounts = new Map<string, number>();
    const playerLastMatch = new Map<string, number>();
    const playingNow = new Set<string>();

    for (const m of allMatches) {
      if (m.id === match.id) continue; // exclude the just-completed match
      for (const mp of m.players) {
        if (m.status === "completed") {
          playerMatchCounts.set(mp.playerId, (playerMatchCounts.get(mp.playerId) || 0) + 1);
          const ts = m.createdAt.getTime();
          if (ts > (playerLastMatch.get(mp.playerId) || 0)) {
            playerLastMatch.set(mp.playerId, ts);
          }
        }
        if (m.status === "pending" || m.status === "active") {
          playingNow.add(mp.playerId);
        }
      }
    }

    // Add counts from the just-completed match
    for (const mp of match.players) {
      playerMatchCounts.set(mp.playerId, (playerMatchCounts.get(mp.playerId) || 0) + 1);
      playerLastMatch.set(mp.playerId, Date.now());
    }

    // Get winners/losers for King of Court
    const { winnerPlayerIds, loserPlayerIds } = getMatchWinnerLoser(match.players);

    const playerStats = eventPlayers.map((ep) => ({
      id: ep.player.id,
      name: ep.player.name,
      rating: ep.player.rating,
      gender: ep.player.gender,
      skillLevel: ep.skillLevel,
      matchesPlayed: playerMatchCounts.get(ep.player.id) || 0,
      lastMatchEndedAt: playerLastMatch.get(ep.player.id) || 0,
      isPlaying: playingNow.has(ep.player.id),
    }));

    const result = generateNextMatch(playerStats, {
      format: (match.class.format || "doubles") as "singles" | "doubles",
      pairingMode: match.class.pairingMode || "random",
      prioSpeed: match.class.prioSpeed ?? true,
      prioFairness: match.class.prioFairness ?? true,
      prioSkill: match.class.prioSkill ?? false,
      courtNum: match.courtNum,
      numCourts: match.event.numCourts,
      winners: winnerPlayerIds,
      losers: loserPlayerIds,
    });

    if (result && !result.shouldWait) {
      const maxRound = allMatches.length > 0
        ? Math.max(...allMatches.map((m) => m.round))
        : 0;

      await prisma.match.create({
        data: {
          eventId: match.eventId,
          classId: match.classId,
          courtNum: result.courtNum,
          round: maxRound + 1,
          rankingMode: match.rankingMode,
          players: {
            create: [
              ...result.team1.map((pid) => ({ playerId: pid, team: 1 })),
              ...result.team2.map((pid) => ({ playerId: pid, team: 2 })),
            ],
          },
        },
      });
    }
  }
}

/**
 * Add players to a bracket match slot (team 1 or team 2).
 */
async function fillBracketSlot(
  eventId: string,
  bracketStage: string,
  bracketPosition: number,
  team: number,
  playerIds: string[]
) {
  const targetMatch = await prisma.match.findFirst({
    where: { eventId, bracketStage, bracketPosition },
    include: { players: true },
  });

  if (!targetMatch) return;

  // Check if this team slot is already filled
  const existingTeamPlayers = targetMatch.players.filter((p) => p.team === team);
  if (existingTeamPlayers.length > 0) return; // already filled

  // Add players to the match
  for (const playerId of playerIds) {
    await prisma.matchPlayer.create({
      data: { matchId: targetMatch.id, playerId, team },
    });
  }
}

// PUT: Edit score on a completed match (admin only) — reverses old ELO, applies new
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { team1Score, team2Score } = await req.json();

  if (team1Score === undefined || team2Score === undefined) {
    return NextResponse.json({ error: "Scores required" }, { status: 400 });
  }
  if (team1Score === team2Score) {
    return NextResponse.json({ error: "Scores cannot be tied" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({
    where: { id },
    include: { players: { include: { player: true } } },
  });

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  if (match.status !== "completed") {
    return NextResponse.json({ error: "Match is not completed yet — use POST to submit initial score" }, { status: 400 });
  }

  // Reverse old ELO if it was applied
  if (match.eloChange > 0) {
    await reverseElo(id);
  }

  // Update MatchPlayer scores
  const team1Players = match.players.filter((mp) => mp.team === 1);
  const team2Players = match.players.filter((mp) => mp.team === 2);
  for (const mp of team1Players) {
    await prisma.matchPlayer.update({ where: { id: mp.id }, data: { score: team1Score } });
  }
  for (const mp of team2Players) {
    await prisma.matchPlayer.update({ where: { id: mp.id }, data: { score: team2Score } });
  }

  // Reset ELO change
  await prisma.match.update({ where: { id }, data: { eloChange: 0, scoreConfirmed: false } });

  let newChange = 0;
  if (match.rankingMode === "ranked") {
    newChange = await applyElo(id);
  }

  return NextResponse.json({
    ok: true,
    winnerTeam: team1Score > team2Score ? 1 : 2,
    eloChange: newChange,
    edited: true,
  });
}

// PATCH: Confirm score (for approval mode) — applies ELO
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const match = await prisma.match.findUnique({
    where: { id },
    include: { players: true },
  });

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  if (match.status !== "completed") {
    return NextResponse.json({ error: "Match not completed" }, { status: 400 });
  }
  if (match.rankingMode !== "approval") {
    return NextResponse.json({ error: "Match does not require approval" }, { status: 400 });
  }
  if (match.scoreConfirmed) {
    return NextResponse.json({ error: "Score already confirmed" }, { status: 400 });
  }

  // Allow admin or any player in this match to confirm
  const isMatchPlayer = match.players.some((mp) => mp.playerId === user.id);
  if (user.role !== "admin" && !isMatchPlayer) {
    return NextResponse.json({ error: "Only match participants or admins can confirm" }, { status: 403 });
  }

  const change = await applyElo(id);

  return NextResponse.json({
    ok: true,
    eloChange: change,
    confirmed: true,
  });
}
