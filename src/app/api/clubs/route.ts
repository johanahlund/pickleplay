import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// List clubs the current user is a member of
export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const memberships = await prisma.clubMember.findMany({
    where: { playerId: user.id },
    include: {
      club: {
        include: {
          _count: { select: { members: true, events: true } },
        },
      },
    },
    orderBy: { club: { name: "asc" } },
  });

  return NextResponse.json(
    memberships.map((m) => ({
      ...m.club,
      myRole: m.role,
    }))
  );
}

// Create a new club
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, emoji } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  const club = await prisma.club.create({
    data: {
      name: name.trim(),
      emoji: emoji || "🏓",
      createdById: user.id,
      members: {
        create: { playerId: user.id, role: "owner" },
      },
    },
  });

  return NextResponse.json(club);
}
