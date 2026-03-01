import { prisma } from "@/lib/db";
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { team1Score, team2Score } = await req.json();

  if (team1Score === undefined || team2Score === undefined) {
    return NextResponse.json({ error: "Scores required" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({
    where: { id },
    include: { players: { include: { player: true } } },
  });

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
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

  // Update match status
  await prisma.match.update({
    where: { id },
    data: { status: "completed" },
  });

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
  const winners =
    winnerTeam === 1 ? team1Players : team2Players;
  const losers =
    winnerTeam === 1 ? team2Players : team1Players;

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

  return NextResponse.json({
    ok: true,
    winnerTeam,
    eloChange: change,
  });
}
