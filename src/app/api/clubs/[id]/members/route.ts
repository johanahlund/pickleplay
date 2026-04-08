import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

async function requireClubAdmin(clubId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;
  const member = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId, playerId: user.id } },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new Error("Not authorized");
  }
  return user;
}

// Add member to club
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireClubAdmin(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { playerId, role } = await req.json();
  if (!playerId) {
    return NextResponse.json({ error: "playerId required" }, { status: 400 });
  }

  const existing = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Already a member" }, { status: 400 });
  }

  await prisma.clubMember.create({
    data: { clubId: id, playerId, role: role || "member" },
  });

  return NextResponse.json({ ok: true });
}

// Remove member from club
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireClubAdmin(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { playerId } = await req.json();
  await prisma.clubMember.deleteMany({
    where: { clubId: id, playerId },
  });

  return NextResponse.json({ ok: true });
}

// Update member role
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try {
    user = await requireClubAdmin(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const { playerId, role } = await req.json();
  if (!playerId || !role || !["owner", "admin", "member"].includes(role)) {
    return NextResponse.json({ error: "playerId and valid role required" }, { status: 400 });
  }

  // Check if target is currently the owner — only app admin can change owner's role
  const targetMember = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId } },
  });
  if (targetMember?.role === "owner" && user.role !== "admin") {
    return NextResponse.json({ error: "Only app admin can change the owner's role" }, { status: 403 });
  }

  // Ownership transfer requires current owner or app admin
  if (role === "owner") {
    const callerMember = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: id, playerId: user.id } },
    });
    const isClubOwner = callerMember?.role === "owner";
    const isAppAdmin = user.role === "admin";
    if (!isClubOwner && !isAppAdmin) {
      return NextResponse.json({ error: "Only the club owner or app admin can transfer ownership" }, { status: 403 });
    }

    // Demote current owner to admin
    await prisma.clubMember.updateMany({
      where: { clubId: id, role: "owner" },
      data: { role: "admin" },
    });
  }

  await prisma.clubMember.update({
    where: { clubId_playerId: { clubId: id, playerId } },
    data: { role },
  });

  return NextResponse.json({ ok: true });
}
