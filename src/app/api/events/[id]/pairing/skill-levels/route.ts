import { prisma } from "@/lib/db";
import { requireEventManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";
import { autoAssignSkillLevel } from "@/lib/solver/skillAssign";

/**
 * PATCH /api/events/[id]/pairing/skill-levels
 *
 * Two-mode endpoint:
 *
 *   1. Bulk override: body = { updates: [{ eventPlayerId, skillLevel }, ...] }
 *      Writes the given manual overrides. Leaves autoSkillLevel untouched.
 *
 *   2. Recalculate all: body = { action: "recalculate", classId: "..." }
 *      Recomputes autoSkillLevel for every player in the class from their
 *      current DUPR / app rating and ALSO resets skillLevel to that value.
 *      Admin's way to wipe all overrides and start fresh.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null) as
    | { updates: { eventPlayerId: string; skillLevel: number | null }[] }
    | { action: "recalculate"; classId: string }
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if ("action" in body && body.action === "recalculate") {
    if (!body.classId) {
      return NextResponse.json({ error: "classId required" }, { status: 400 });
    }
    // Pull players with their current ratings.
    const players = await prisma.eventPlayer.findMany({
      where: { eventId: id, classId: body.classId },
      select: {
        id: true,
        player: {
          select: { duprRating: true, globalRating: true },
        },
      },
    });

    // Update each one. Small loop — fine for typical event sizes (< 100).
    for (const ep of players) {
      const level = autoAssignSkillLevel({
        duprRating: ep.player.duprRating,
        globalRating: ep.player.globalRating,
      });
      await prisma.eventPlayer.update({
        where: { id: ep.id },
        data: { autoSkillLevel: level, skillLevel: level },
      });
    }
    return NextResponse.json({ ok: true, updated: players.length });
  }

  if ("updates" in body) {
    if (!Array.isArray(body.updates)) {
      return NextResponse.json({ error: "updates must be an array" }, { status: 400 });
    }
    for (const u of body.updates) {
      if (!u.eventPlayerId) continue;
      if (u.skillLevel !== null && (typeof u.skillLevel !== "number" || u.skillLevel < 1 || u.skillLevel > 5)) {
        return NextResponse.json({ error: "skillLevel must be 1-5 or null" }, { status: 400 });
      }
      // Verify the player belongs to this event (defense-in-depth).
      const ep = await prisma.eventPlayer.findUnique({
        where: { id: u.eventPlayerId },
        select: { eventId: true },
      });
      if (!ep || ep.eventId !== id) continue;
      await prisma.eventPlayer.update({
        where: { id: u.eventPlayerId },
        data: { skillLevel: u.skillLevel },
      });
    }
    return NextResponse.json({ ok: true, updated: body.updates.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
