import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: get club info for this invite token (public, no auth needed for display)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.clubInvite.findUnique({
    where: { token },
    include: {
      club: {
        select: { id: true, name: true, emoji: true, _count: { select: { members: true } } },
      },
    },
  });

  if (!invite || !invite.active) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
  }

  if (invite.maxUses && invite.usedCount >= invite.maxUses) {
    return NextResponse.json({ error: "This invite has reached its limit" }, { status: 410 });
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  return NextResponse.json({
    club: invite.club,
    token: invite.token,
  });
}

// POST: accept invite and join the club
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const invite = await prisma.clubInvite.findUnique({
    where: { token },
    include: { club: { select: { id: true, name: true } } },
  });

  if (!invite || !invite.active) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 404 });
  }

  if (invite.maxUses && invite.usedCount >= invite.maxUses) {
    return NextResponse.json({ error: "This invite has reached its limit" }, { status: 410 });
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  // Check if already a member
  const existing = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: invite.clubId, playerId: user.id } },
  });

  if (existing) {
    return NextResponse.json({ ok: true, status: "already_member", clubId: invite.clubId });
  }

  // Add as member
  await prisma.clubMember.create({
    data: { clubId: invite.clubId, playerId: user.id, role: "member" },
  });

  // Increment used count
  await prisma.clubInvite.update({
    where: { id: invite.id },
    data: { usedCount: { increment: 1 } },
  });

  return NextResponse.json({ ok: true, status: "joined", clubId: invite.clubId, clubName: invite.club.name });
}
