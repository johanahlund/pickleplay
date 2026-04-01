import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Get club details
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const club = await prisma.club.findUnique({
    where: { id },
    include: {
      members: {
        include: { player: { select: { id: true, name: true, emoji: true, rating: true, gender: true, phone: true } } },
        orderBy: { player: { name: "asc" } },
      },
      whatsappGroups: { orderBy: { name: "asc" } },
      _count: { select: { events: true } },
    },
  });

  if (!club) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(club);
}

// Update club
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAuth();

  const member = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin" && user.role !== "admin")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { name, emoji } = await req.json();
  const data: { name?: string; emoji?: string } = {};
  if (name?.trim()) data.name = name.trim();
  if (emoji) data.emoji = emoji;

  const club = await prisma.club.update({ where: { id }, data });
  return NextResponse.json(club);
}

// Delete club
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAuth();

  const member = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!member || (member.role !== "owner" && user.role !== "admin")) {
    return NextResponse.json({ error: "Only the club owner can delete" }, { status: 403 });
  }

  await prisma.club.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
