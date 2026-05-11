import { prisma } from "@/lib/db";
import { requireEventManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";
import { backfillSocialEvent, findSocialEvent } from "@/lib/socialEventSync";

/**
 * Enable / disable a parallel "social side" event linked to this league
 * event. Sign-ups always happen on the league event; the social event
 * mirrors qualifying sign-ups (intent ∈ {playing, social}, not unavailable)
 * so it can run as a normal event (check-ins, pairing, matches, scoring)
 * for the casual play happening alongside the league lineup.
 *
 *   GET    → { social: { id, name } | null }
 *   POST   → enable (create linked event + backfill); idempotent
 *   DELETE → disable (delete linked event); refuses if any matches exist
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const social = await prisma.event.findFirst({
    where: { socialOfEventId: id },
    select: { id: true, name: true, status: true, numCourts: true },
  });
  return NextResponse.json({ social });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const parent = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true, name: true, date: true, endDate: true,
      clubId: true, locationId: true, numCourts: true, roundId: true,
    },
  });
  if (!parent) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!parent.roundId) {
    return NextResponse.json({ error: "Social side is only for league match-day events." }, { status: 400 });
  }

  // Idempotent: if one already exists, just backfill and return it.
  const existing = await findSocialEvent(id);
  if (existing) {
    const { added } = await backfillSocialEvent(id);
    return NextResponse.json({ ok: true, socialEventId: existing.id, created: false, added });
  }

  const social = await prisma.event.create({
    data: {
      name: `${parent.name} — social`,
      date: parent.date,
      endDate: parent.endDate,
      clubId: parent.clubId,
      locationId: parent.locationId,
      numCourts: parent.numCourts,
      status: "open",
      socialOfEventId: id,
      createdById: user.id,
      // No roundId — this is a standalone social event, not league.
      classes: {
        create: [{
          name: "Social",
          format: "doubles",
          pairingMode: "random",
          isDefault: true,
        }],
      },
    },
    select: { id: true },
  });

  const { added } = await backfillSocialEvent(id);
  return NextResponse.json({ ok: true, socialEventId: social.id, created: true, added });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const social = await prisma.event.findFirst({
    where: { socialOfEventId: id },
    select: { id: true, _count: { select: { matches: true } } },
  });
  if (!social) return NextResponse.json({ ok: true, deleted: false });

  if (social._count.matches > 0) {
    return NextResponse.json(
      { error: "Social event has matches recorded — open it and clear matches first, or delete it directly." },
      { status: 400 },
    );
  }

  // EventPlayer / EventClass / etc. cascade on Event delete in the schema.
  await prisma.event.delete({ where: { id: social.id } });
  return NextResponse.json({ ok: true, deleted: true });
}
