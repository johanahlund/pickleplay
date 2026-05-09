import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// List clubs the current user is a member of.
// App admins get all clubs back, with `myRole` set to their real role when
// they are a member, or "admin" (synthetic) otherwise — so admin mode behaves
// as if they belong to every club.
export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  if (user.role === "admin") {
    const [allClubs, myMemberships] = await Promise.all([
      prisma.club.findMany({
        include: { _count: { select: { members: true, events: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.clubMember.findMany({
        where: { playerId: user.id },
        select: { clubId: true, role: true },
      }),
    ]);
    const roleByClub = new Map(myMemberships.map((m) => [m.clubId, m.role]));
    return NextResponse.json(
      allClubs.map((c) => ({ ...c, myRole: roleByClub.get(c.id) || "admin" }))
    );
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

  const { name, shortName, description, city, country, status, locations } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const cleanShortName = typeof shortName === "string" && shortName.trim()
    ? shortName.trim().slice(0, 10)
    : null;
  const validStatuses = ["draft", "active", "closed"];
  const cleanStatus = status && validStatuses.includes(status) ? status : "active";

  const club = await prisma.club.create({
    data: {
      name: name.trim(),
      shortName: cleanShortName,
      emoji: "🏟️",
      description: description?.trim() || null,
      city: city?.trim() || null,
      country: country?.trim() || null,
      status: cleanStatus,
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
