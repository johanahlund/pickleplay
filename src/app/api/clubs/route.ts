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

  const { name, description, city, country, locations } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  const club = await prisma.club.create({
    data: {
      name: name.trim(),
      emoji: "🏓",
      description: description?.trim() || null,
      city: city?.trim() || null,
      country: country?.trim() || null,
      createdById: user.id,
      members: {
        create: { playerId: user.id, role: "owner" },
      },
      ...(locations?.length ? {
        locations: {
          create: locations.filter((l: { name: string }) => l.name?.trim()).map((l: { name: string; googleMapsUrl?: string }) => ({
            name: l.name.trim(),
            googleMapsUrl: l.googleMapsUrl?.trim() || null,
          })),
        },
      } : {}),
    },
  });

  return NextResponse.json(club);
}
