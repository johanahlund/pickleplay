import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// PATCH: update team
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { teamId } = await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.captainId !== undefined) data.captainId = body.captainId || null;
  if (body.viceCaptainId !== undefined) data.viceCaptainId = body.viceCaptainId || null;
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl;

  const team = await prisma.leagueTeam.update({ where: { id: teamId }, data });
  return NextResponse.json(team);
}

// DELETE: remove team
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { teamId } = await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  await prisma.leagueTeam.delete({ where: { id: teamId } });
  return NextResponse.json({ ok: true });
}
