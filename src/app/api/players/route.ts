import { prisma } from "@/lib/db";
import { requireAuth, canSeeEmails } from "@/lib/auth";
import { NextResponse } from "next/server";

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
  const { name, emoji, gender, phone } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const player = await prisma.player.create({
    data: { name: name.trim(), emoji: emoji || "🏓", ...(gender ? { gender } : {}), ...(phone ? { phone: phone.trim() } : {}) },
  });
  return NextResponse.json(player);
}
