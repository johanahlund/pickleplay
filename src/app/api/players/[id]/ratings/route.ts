import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { estimateGlobalRating } from "@/lib/ratings";

// GET: all ratings for a player
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const player = await prisma.player.findUnique({
    where: { id },
    select: {
      id: true, name: true, emoji: true,
      rating: true, wins: true, losses: true,
      globalRating: true, globalRatingConfidence: true,
      globalWins: true, globalLosses: true,
      duprRating: true, duprId: true,
    },
  });

  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });

  // Get club ratings
  const clubRatings = await prisma.clubPlayerRating.findMany({
    where: { playerId: id },
    include: { club: { select: { id: true, name: true, emoji: true, ratingOffset: true, ratingBridgePlayers: true } } },
  });

  const clubs = clubRatings.map((cr) => {
    const global = estimateGlobalRating(
      player.globalRating,
      player.globalRatingConfidence,
      cr.rating,
      cr.club.ratingOffset
    );
    return {
      clubId: cr.clubId,
      clubName: cr.club.name,
      clubEmoji: cr.club.emoji,
      clubRating: Math.round(cr.rating),
      clubWins: cr.wins,
      clubLosses: cr.losses,
      estimatedGlobal: global.rating ? Math.round(global.rating) : null,
      globalIsEstimate: global.isEstimate,
      globalConfidence: global.confidence,
    };
  });

  return NextResponse.json({
    player: {
      id: player.id,
      name: player.name,
      emoji: player.emoji,
    },
    legacy: {
      rating: Math.round(player.rating),
      wins: player.wins,
      losses: player.losses,
    },
    global: {
      rating: player.globalRating ? Math.round(player.globalRating) : null,
      confidence: player.globalRatingConfidence,
      wins: player.globalWins,
      losses: player.globalLosses,
    },
    dupr: {
      rating: player.duprRating,
      id: player.duprId,
    },
    clubs,
  });
}
