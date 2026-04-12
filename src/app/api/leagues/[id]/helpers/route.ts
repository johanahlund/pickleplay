import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: add a helper
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { playerId } = await req.json();
  if (!playerId) return NextResponse.json({ error: "playerId required" }, { status: 400 });

  const existing = await prisma.leagueHelper.findUnique({ where: { leagueId_playerId: { leagueId: id, playerId } } });
  if (existing) return NextResponse.json(existing);

  const helper = await prisma.leagueHelper.create({ data: { leagueId: id, playerId } });
  return NextResponse.json(helper);
}

// DELETE: remove a helper
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { playerId } = await req.json();
  if (!playerId) return NextResponse.json({ error: "playerId required" }, { status: 400 });

  await prisma.leagueHelper.deleteMany({ where: { leagueId: id, playerId } });
  return NextResponse.json({ ok: true });
}
