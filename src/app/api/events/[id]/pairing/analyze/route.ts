import { prisma } from "@/lib/db";
import { requireEventManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";
import { analyzePool } from "@/lib/solver/analyzePool";
import { autoAssignSkillLevel } from "@/lib/solver/skillAssign";
import type {
  PairLock,
  PairingSettings,
  SolverPlayer,
  MatchHistoryEntry,
  SkillLevel,
} from "@/lib/solver/types";

/**
 * POST /api/events/[id]/pairing/analyze
 *
 * Run the pool analyzer with proposed settings (without saving anything).
 * Powers the live "what's feasible?" feedback on the event configuration
 * screen — the organizer tweaks locks/settings and this endpoint reports
 * what the solver would produce.
 *
 * Body:
 *   {
 *     classId: string,
 *     settings: PairingSettings,
 *     locks?: { playerAId: string; playerBId: string }[]
 *   }
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
  if (!body?.classId || !body.settings) {
    return NextResponse.json({ error: "classId and settings required" }, { status: 400 });
  }

  // Coerce Infinity sentinels (JSON → number/null).
  const settings = normalizeSettings(body.settings);

  // Before event starts (no matches), include registered players too (assumes they'll show up).
  // Once matches exist, only checked_in players are relevant.
  const matchCount = await prisma.match.count({ where: { eventId: id } });
  const statusFilter = matchCount === 0 ? ["registered", "checked_in"] : ["checked_in"];

  // Pull class + players + ratings + history.
  const eventClass = await prisma.eventClass.findUnique({
    where: { id: body.classId },
    select: {
      eventId: true,
      event: { select: { numCourts: true } },
      players: {
        where: { status: { in: statusFilter } },
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

  // Build SolverPlayer list — prefer manual skillLevel, fall back to
  // autoSkillLevel, then auto-assign from DUPR/rating on the fly.
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
      matchCount: 0, // history is reconstructed below
      paused: ep.status === "paused",
    };
  });

  // Load completed match history for this class to feed the solver's
  // variety tracking and compute current match counts.
  const matches = await prisma.match.findMany({
    where: { eventId: id, classId: body.classId },
    select: {
      round: true,
      courtNum: true,
      players: {
        select: { playerId: true, team: true },
      },
    },
    orderBy: { round: "asc" },
  });

  const history: MatchHistoryEntry[] = [];
  const counts = new Map<string, number>();
  for (const m of matches) {
    const t1 = m.players.filter((p) => p.team === 1).map((p) => p.playerId);
    const t2 = m.players.filter((p) => p.team === 2).map((p) => p.playerId);
    if (t1.length !== 2 || t2.length !== 2) continue; // skip non-doubles for now
    history.push({
      round: m.round,
      courtNum: m.courtNum,
      team1Ids: [t1[0], t1[1]],
      team2Ids: [t2[0], t2[1]],
    });
    for (const id of [...t1, ...t2]) counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const p of solverPlayers) p.matchCount = counts.get(p.id) || 0;

  // Locks: use override from body if provided, else pull from DB.
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

  const analysis = analyzePool(
    solverPlayers,
    eventClass.event.numCourts,
    settings,
    locks,
  );

  return NextResponse.json(analysis);
}

function normalizeGender(g: string | null | undefined): "M" | "F" | null {
  if (g === "M" || g === "F") return g;
  return null;
}

/**
 * Normalize a partial settings payload into a full PairingSettings.
 * JSON doesn't have an Infinity sentinel, so we accept null / undefined / "inf"
 * as "no limit" and map them to Infinity.
 */
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
    maxWaitWindow: s.maxWaitWindow === undefined ? Infinity : inf(s.maxWaitWindow),
  };
}
