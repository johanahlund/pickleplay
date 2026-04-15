import { prisma } from "@/lib/db";
import { requireAuth, canSeeEmails } from "@/lib/auth";
import { NextResponse } from "next/server";

async function canAddPlayer(userId: string, userRole: string, clubId?: string) {
  if (userRole === "admin") return true;
  if (!clubId) return false;
  const member = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId, playerId: userId } },
    select: { role: true },
  });
  if (!member) return false;
  return member.role === "owner" || member.role === "admin";
}

export async function GET() {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const players = await prisma.player.findMany({
    where: { status: "active" },
    orderBy: { rating: "desc" },
    select: {
      id: true,
      name: true,
      emoji: true,
      email: true,
      rating: true,
      wins: true,
      losses: true,
      photoUrl: true,
      gender: true,
      phone: true,
      role: true,
      passwordHash: true, // only used to derive hasAccount below
      _count: { select: { matchPlayers: true } },
      clubMembers: {
        select: {
          role: true,
          club: { select: { id: true, name: true, emoji: true } },
        },
      },
    },
  });

  const allowEmail = await canSeeEmails(user.id, user.role);

  // Strip passwordHash, add hasAccount flag, optionally strip email, flatten
  // club memberships into a lightweight `clubs` array.
  const safe = players.map(({ passwordHash, email, clubMembers, ...rest }) => ({
    ...rest,
    ...(allowEmail ? { email } : {}),
    hasAccount: !!passwordHash,
    clubs: clubMembers.map((m) => ({
      id: m.club.id,
      name: m.club.name,
      emoji: m.club.emoji,
      role: m.role,
    })),
  }));

  return NextResponse.json(safe);
}

export async function POST(req: Request) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, emoji, gender, phone, clubId } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const cleanName = name.trim();

  // Auth: app admin can always add. A club owner/admin can add only when
  // attaching the new player to their own club.
  const allowed = await canAddPlayer(user.id, user.role, clubId);
  if (!allowed) {
    return NextResponse.json(
      { error: clubId ? "Not allowed to add players to this club" : "Only admins can add players without a club" },
      { status: 403 },
    );
  }

  // Uniqueness check: no two active players with the same name. Case-insensitive
  // comparison so "Johan A" and "johan a" also conflict.
  const existing = await prisma.player.findFirst({
    where: {
      name: { equals: cleanName, mode: "insensitive" },
      status: { not: "voided" },
    },
    select: { id: true, name: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `A player named "${existing.name}" already exists. Pick a different name or add a suffix (e.g. "${cleanName} 2").` },
      { status: 409 },
    );
  }

  const player = await prisma.player.create({
    data: {
      name: cleanName,
      emoji: emoji || "🏓",
      ...(gender ? { gender } : {}),
      ...(phone ? { phone: phone.trim() } : {}),
    },
  });

  // Attach to club if requested.
  if (clubId) {
    await prisma.clubMember.create({
      data: { clubId, playerId: player.id, role: "member" },
    });
  }

  return NextResponse.json(player);
}
