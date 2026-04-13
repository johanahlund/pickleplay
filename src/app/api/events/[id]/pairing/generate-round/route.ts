import { prisma } from "@/lib/db";
import { requireEventManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";
import { generateRound } from "@/lib/solver/generateRound";
import { autoAssignSkillLevel } from "@/lib/solver/skillAssign";
import type {
  MatchHistoryEntry,
  PairLock,
  PairingSettings,
  SkillLevel,
  SolverInput,
  SolverPlayer,
} from "@/lib/solver/types";

/**
 * POST /api/events/[id]/pairing/generate-round
 *
 * Generate the next round for a class using the new unified solver
 * (src/lib/solver). Writes the resulting matches as Match + MatchPlayer
 * rows, same as the legacy route, so downstream code (scoring, ranking,
 * live view) doesn't need to change.
 *
 * Body:
 *   {
 *     classId: string,
 *     settings: PairingSettings,
 *     locks?: { playerAId: string; playerBId: string }[]  // override for preview
 *   }
 *
 * If `settings` is omitted, reads the saved pairingSettings JSON from the
 * EventClass. If still not present, defaults are applied.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null) as {
    classId?: string;
    settings?: Partial<PairingSettings>;
    locks?: { playerAId: string; playerBId: string }[];
  } | null;
  if (!body?.classId) {
    return NextResponse.json({ error: "classId required" }, { status: 400 });
  }

  const eventClass = await prisma.eventClass.findUnique({
    where: { id: body.classId },
    select: {
      eventId: true,
      format: true,
      pairingSettings: true,
      event: { select: { numCourts: true } },
      players: {
        where: { status: { in: ["registered", "active", "confirmed"] } },
        select: {
          id: true,
          playerId: true,
          skillLevel: true,
          autoSkillLevel: true,
          status: true,
          player: {
            select: {
              id: true,
              name: true,
              gender: true,
              rating: true,
              globalRating: true,
              duprRating: true,
            },
          },
        },
      },
    },
  });

  if (!eventClass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (eventClass.eventId !== id) {
    return NextResponse.json({ error: "Class does not belong to this event" }, { status: 403 });
  }
  if (eventClass.format !== "doubles") {
    return NextResponse.json(
      { error: "New solver only supports doubles in v1 — use legacy route for singles" },
      { status: 400 },
    );
  }

  const settings = normalizeSettings(
    body.settings ||
      (eventClass.pairingSettings as Partial<PairingSettings> | null) ||
      {},
  );

  // Build the solver player list.
  const solverPlayers: SolverPlayer[] = eventClass.players.map((ep) => {
    const level: SkillLevel =
      (ep.skillLevel as SkillLevel | null) ??
      (ep.autoSkillLevel as SkillLevel | null) ??
      autoAssignSkillLevel({
        duprRating: ep.player.duprRating,
        globalRating: ep.player.globalRating,
      });
    return {
      id: ep.playerId,
      name: ep.player.name,
      skillLevel: level,
      gender: normalizeGender(ep.player.gender),
      matchCount: 0,
      paused: ep.status === "paused",
    };
  });

  // Load history (used matches feed variety tracking + match counts).
  const pastMatches = await prisma.match.findMany({
    where: { eventId: id, classId: body.classId },
    select: {
      round: true,
      courtNum: true,
      players: { select: { playerId: true, team: true } },
    },
    orderBy: { round: "asc" },
  });

  const history: MatchHistoryEntry[] = [];
  const counts = new Map<string, number>();
  let maxRound = 0;
  for (const m of pastMatches) {
    maxRound = Math.max(maxRound, m.round);
    const t1 = m.players.filter((p) => p.team === 1).map((p) => p.playerId);
    const t2 = m.players.filter((p) => p.team === 2).map((p) => p.playerId);
    if (t1.length === 2 && t2.length === 2) {
      history.push({
        round: m.round,
        courtNum: m.courtNum,
        team1Ids: [t1[0], t1[1]],
        team2Ids: [t2[0], t2[1]],
      });
    }
    for (const p of m.players) counts.set(p.playerId, (counts.get(p.playerId) || 0) + 1);
  }
  for (const p of solverPlayers) p.matchCount = counts.get(p.id) || 0;

  // Locks (from body override or DB).
  let locks: PairLock[];
  if (body.locks) {
    locks = body.locks.map((l) => ({ playerAId: l.playerAId, playerBId: l.playerBId }));
  } else {
    const dbLocks = await prisma.eventPairLock.findMany({
      where: { eventId: id, classId: body.classId },
      select: { playerAId: true, playerBId: true },
    });
    locks = dbLocks.map((l) => ({ playerAId: l.playerAId, playerBId: l.playerBId }));
  }

  const input: SolverInput = {
    players: solverPlayers,
    numCourts: eventClass.event.numCourts,
    settings,
    history,
    locks,
  };

  const result = generateRound(input);
  if (result.round.length === 0) {
    return NextResponse.json({
      error: "No matches could be generated for this round",
      violations: result.violations,
      sittingOut: result.sittingOut,
    }, { status: 400 });
  }

  // Persist the matches.
  const nextRound = maxRound + 1;
  const createdMatchIds: string[] = [];
  for (const m of result.round) {
    const match = await prisma.match.create({
      data: {
        eventId: id,
        classId: body.classId,
        round: nextRound,
        courtNum: m.court,
        status: "pending",
        players: {
          create: [
            { playerId: m.team1.player1Id, team: 1, score: 0 },
            { playerId: m.team1.player2Id, team: 1, score: 0 },
            { playerId: m.team2.player1Id, team: 2, score: 0 },
            { playerId: m.team2.player2Id, team: 2, score: 0 },
          ],
        },
      },
      select: { id: true },
    });
    createdMatchIds.push(match.id);
  }

  return NextResponse.json({
    round: nextRound,
    matches: createdMatchIds,
    cost: result.cost,
    violations: result.violations,
    sittingOut: result.sittingOut,
  });
}

function normalizeGender(g: string | null | undefined): "M" | "F" | null {
  if (g === "M" || g === "F") return g;
  return null;
}

function normalizeSettings(s: Partial<PairingSettings>): PairingSettings {
  const inf = (v: unknown): number => {
    if (v === null || v === undefined) return Infinity;
    if (v === "inf" || v === "infinity") return Infinity;
    return Number(v);
  };
  return {
    base: (s.base as PairingSettings["base"]) ?? "random",
    teams: (s.teams as PairingSettings["teams"]) ?? "rotating",
    gender: (s.gender as PairingSettings["gender"]) ?? "random",
    skillWindow: inf(s.skillWindow),
    matchCountWindow: inf(s.matchCountWindow),
    varietyWindow: inf(s.varietyWindow),
  };
}
