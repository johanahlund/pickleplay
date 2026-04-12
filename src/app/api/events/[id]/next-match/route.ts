import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { safePlayerSelect } from "@/lib/playerSelect";
import { NextResponse } from "next/server";
import { generateNextMatch } from "@/lib/rotation";
import { getEventClass } from "@/lib/eventClass";

// GET: check what the next match would be for each free court
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireAuth(); } catch { return NextResponse.json({ error: "Login required" }, { status: 401 }); }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      players: { include: { player: { select: safePlayerSelect } } },
      matches: { include: { players: true } },
    },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const cls = await getEventClass(id);
  if (!cls || cls.playMode !== "continuous") {
    return NextResponse.json({ suggestions: [] });
  }

  // Build player stats
  const playerMatchCounts = new Map<string, number>();
  const playerLastMatch = new Map<string, number>();
  const playingNow = new Set<string>();

  for (const m of event.matches) {
    for (const mp of m.players) {
      if (m.status === "completed") {
        playerMatchCounts.set(mp.playerId, (playerMatchCounts.get(mp.playerId) || 0) + 1);
        const ts = m.createdAt.getTime();
        if (ts > (playerLastMatch.get(mp.playerId) || 0)) playerLastMatch.set(mp.playerId, ts);
      }
      if (m.status === "active") playingNow.add(mp.playerId);
    }
  }

  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId: id, status: { in: ["registered", "checked_in"] } },
    include: { player: { select: safePlayerSelect } },
  });

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

  // Check each court
  const activeCourts = new Set(event.matches.filter((m) => m.status === "active").map((m) => m.courtNum));
  const pendingCourts = new Set(event.matches.filter((m) => m.status === "pending" && m.players.length >= 2).map((m) => m.courtNum));
  const suggestions = [];

  for (let court = 1; court <= event.numCourts; court++) {
    if (activeCourts.has(court) || pendingCourts.has(court)) continue;

    const result = generateNextMatch(playerStats, {
      format: (cls.format || "doubles") as "singles" | "doubles",
      pairingMode: cls.pairingMode || "random",
      prioSpeed: cls.prioSpeed ?? true,
      prioFairness: cls.prioFairness ?? true,
      prioSkill: cls.prioSkill ?? false,
      courtNum: court,
      numCourts: event.numCourts,
    });

    if (result) {
      suggestions.push(result);
    }
  }

  return NextResponse.json({ suggestions });
}
