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

  // Allow admin or any player in this match
  const isMatchPlayer = match.players.some((mp) => mp.playerId === user.id);
  if (user.role !== "admin" && !isMatchPlayer) {
    return NextResponse.json({ error: "Only match participants or admins can submit scores" }, { status: 403 });
  }

  // Update match player scores
  const team1Players = match.players.filter((mp) => mp.team === 1);
  const team2Players = match.players.filter((mp) => mp.team === 2);

  for (const mp of team1Players) {
    await prisma.matchPlayer.update({
      where: { id: mp.id },
      data: { score: team1Score },
    });
  }
  for (const mp of team2Players) {
    await prisma.matchPlayer.update({
      where: { id: mp.id },
      data: { score: team2Score },
    });
  }

  // Calculate ELO changes
  const team1AvgRating =
    team1Players.reduce((s, mp) => s + mp.player.rating, 0) /
    team1Players.length;
  const team2AvgRating =
    team2Players.reduce((s, mp) => s + mp.player.rating, 0) /
    team2Players.length;

  const winnerTeam = team1Score > team2Score ? 1 : 2;
  const winnerRating = winnerTeam === 1 ? team1AvgRating : team2AvgRating;
  const loserRating = winnerTeam === 1 ? team2AvgRating : team1AvgRating;
  const change = eloChange(winnerRating, loserRating);

  // Update player ratings and win/loss counts
  const winners = winnerTeam === 1 ? team1Players : team2Players;
  const losers = winnerTeam === 1 ? team2Players : team1Players;

  for (const mp of winners) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: {
        rating: { increment: change },
        wins: { increment: 1 },
      },
    });
  }

  for (const mp of losers) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: {
        rating: { decrement: change },
        losses: { increment: 1 },
      },
    });
  }

  // Update match status and store eloChange for future edit reversal
  await prisma.match.update({
    where: { id },
    data: { status: "completed", eloChange: change },
  });

  return NextResponse.json({
    ok: true,
    winnerTeam,
    eloChange: change,
  });
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

  const team1Players = match.players.filter((mp) => mp.team === 1);
  const team2Players = match.players.filter((mp) => mp.team === 2);

  // --- REVERSE OLD ELO ---
  const oldTeam1Score = team1Players[0]?.score ?? 0;
  const oldTeam2Score = team2Players[0]?.score ?? 0;
  const oldWinnerTeam = oldTeam1Score > oldTeam2Score ? 1 : 2;
  const oldWinners = oldWinnerTeam === 1 ? team1Players : team2Players;
  const oldLosers = oldWinnerTeam === 1 ? team2Players : team1Players;
  const oldChange = match.eloChange;

  // Only reverse if we have a stored eloChange (post-migration matches)
  if (oldChange > 0) {
    for (const mp of oldWinners) {
      await prisma.player.update({
        where: { id: mp.playerId },
        data: {
          rating: { decrement: oldChange },
          wins: { decrement: 1 },
        },
      });
    }
    for (const mp of oldLosers) {
      await prisma.player.update({
        where: { id: mp.playerId },
        data: {
          rating: { increment: oldChange },
          losses: { decrement: 1 },
        },
      });
    }
  }

  // --- APPLY NEW ELO ---
  // Re-fetch players to get restored (pre-match) ratings
  const freshMatch = await prisma.match.findUnique({
    where: { id },
    include: { players: { include: { player: true } } },
  });
  const freshT1 = freshMatch!.players.filter((mp) => mp.team === 1);
  const freshT2 = freshMatch!.players.filter((mp) => mp.team === 2);

  const t1Avg = freshT1.reduce((s, mp) => s + mp.player.rating, 0) / freshT1.length;
  const t2Avg = freshT2.reduce((s, mp) => s + mp.player.rating, 0) / freshT2.length;

  const newWinnerTeam = team1Score > team2Score ? 1 : 2;
  const winnerRating = newWinnerTeam === 1 ? t1Avg : t2Avg;
  const loserRating = newWinnerTeam === 1 ? t2Avg : t1Avg;
  const newChange = eloChange(winnerRating, loserRating);

  const newWinners = newWinnerTeam === 1 ? freshT1 : freshT2;
  const newLosers = newWinnerTeam === 1 ? freshT2 : freshT1;

  for (const mp of newWinners) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: {
        rating: { increment: newChange },
        wins: { increment: 1 },
      },
    });
  }
  for (const mp of newLosers) {
    await prisma.player.update({
      where: { id: mp.playerId },
      data: {
        rating: { decrement: newChange },
        losses: { increment: 1 },
      },
    });
  }

  // Update MatchPlayer scores
  for (const mp of freshT1) {
    await prisma.matchPlayer.update({ where: { id: mp.id }, data: { score: team1Score } });
  }
  for (const mp of freshT2) {
    await prisma.matchPlayer.update({ where: { id: mp.id }, data: { score: team2Score } });
  }

  // Store new eloChange
  await prisma.match.update({ where: { id }, data: { eloChange: newChange } });

  return NextResponse.json({
    ok: true,
    winnerTeam: newWinnerTeam,
    eloChange: newChange,
    edited: true,
  });
}
