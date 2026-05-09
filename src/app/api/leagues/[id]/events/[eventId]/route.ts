import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// PATCH: update league-attached event (date, status, hostTeamId).
// Note: in the new model the event already exists when the round is created;
// there's no longer a "create_event" action.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  const { id, eventId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { round: { select: { leagueId: true } } },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.round?.leagueId !== id) {
    return NextResponse.json({ error: "Event does not belong to this league" }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.date !== undefined) data.date = body.date ? new Date(body.date) : new Date();
  if (body.status !== undefined) data.status = body.status;
  if (body.hostTeamId !== undefined) data.hostTeamId = body.hostTeamId;

  if (Object.keys(data).length > 0) {
    await prisma.event.update({ where: { id: eventId }, data });
  }

  return NextResponse.json({ ok: true });
}
