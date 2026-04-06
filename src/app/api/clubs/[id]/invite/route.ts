import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list active invites for this club
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  // Must be club admin/owner
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const invites = await prisma.clubInvite.findMany({
    where: { clubId: id, active: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(invites);
}

// POST: create a new invite link
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  // Must be club admin/owner
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const invite = await prisma.clubInvite.create({
    data: {
      clubId: id,
      createdBy: user.id,
    },
  });

  return NextResponse.json(invite);
}

// DELETE: deactivate an invite
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const membership = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await req.json();
  await prisma.clubInvite.update({
    where: { id: body.inviteId },
    data: { active: false },
  });

  return NextResponse.json({ ok: true });
}
