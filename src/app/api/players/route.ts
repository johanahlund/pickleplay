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
    },
  });

  const allowEmail = await canSeeEmails(user.id, user.role);

  // Strip passwordHash, add hasAccount flag, optionally strip email
  const safe = players.map(({ passwordHash, email, ...rest }) => ({
    ...rest,
    ...(allowEmail ? { email } : {}),
    hasAccount: !!passwordHash,
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

  // Auth: app admin can always add. A club owner/admin can add only when
  // attaching the new player to their own club.
  const allowed = await canAddPlayer(user.id, user.role, clubId);
  if (!allowed) {
    return NextResponse.json(
      { error: clubId ? "Not allowed to add players to this club" : "Only admins can add players without a club" },
      { status: 403 },
    );
  }

  const player = await prisma.player.create({
    data: {
      name: name.trim(),
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
