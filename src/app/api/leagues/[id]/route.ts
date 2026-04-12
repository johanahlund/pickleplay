import { prisma } from "@/lib/db";
import { requireLeagueManager, requireLeagueOwner, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: league details with all relations
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const league = await prisma.league.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      deputy: { select: { id: true, name: true } },
      helpers: { include: { player: { select: { id: true, name: true, photoUrl: true } } } },
      categories: { orderBy: { sortOrder: "asc" } },
      teams: {
        include: {
          club: { select: { id: true, name: true, emoji: true, logoUrl: true } },
          captain: { select: { id: true, name: true, photoUrl: true } },
          viceCaptain: { select: { id: true, name: true, photoUrl: true } },
          players: { include: { player: { select: { id: true, name: true, photoUrl: true, rating: true, gender: true } } } },
          _count: { select: { players: true } },
        },
      },
      rounds: {
        orderBy: { roundNumber: "asc" },
        include: {
          matchDays: {
            include: {
              teams: { include: { team: { select: { id: true, name: true, logoUrl: true } } } },
              games: {
                include: {
                  category: { select: { id: true, name: true } },
                  team1: { select: { id: true, name: true } },
                  team2: { select: { id: true, name: true } },
                  winner: { select: { id: true, name: true } },
                },
              },
              event: { select: { id: true, name: true, date: true, status: true } },
            },
          },
        },
      },
    },
  });
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(league);
}

// PATCH: update league
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Transferring director or assigning deputy is owner-only.
  const ownerOnly = body.createdById !== undefined || body.deputyId !== undefined;
  try {
    if (ownerOnly) await requireLeagueOwner(id);
    else await requireLeagueManager(id);
  } catch (e) { return authErrorResponse(e); }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
  if (body.season !== undefined) data.season = body.season ? String(body.season).trim() : null;
  if (body.status !== undefined) data.status = body.status;
  if (body.config !== undefined) data.config = body.config;
  if (body.deputyId !== undefined) data.deputyId = body.deputyId || null;
  if (body.createdById !== undefined) data.createdById = body.createdById;

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const league = await prisma.league.update({ where: { id }, data });
  return NextResponse.json(league);
}

// DELETE: delete league
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueOwner(id); } catch (e) { return authErrorResponse(e); }
  await prisma.league.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
