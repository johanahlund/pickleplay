import { prisma } from "@/lib/db";
import { requireAuth, requireClubCreator } from "@/lib/auth";
import { NextResponse } from "next/server";

// List clubs the current user is a member of (their "My Clubs"). App
// admins do NOT get a synthetic membership in every club here — they can
// still browse and manage any club via the global admin path, but the
// "My Clubs" list should only reflect actual memberships so the role
// pill ("Director" / "Admin" / "Member") is truthful.
export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  // Include all members on each club so the clubs list can show:
  //   - "Director: X · Admins: Y, Z" (filtered from role)
  //   - total · ♂ count · ♀ count (filtered from gender)
  // Most users belong to a handful of clubs with < a few hundred members
  // each, so loading the full member list is fine for this surface.
  const leaderMembers = {
    select: {
      role: true,
      player: { select: { id: true, name: true, gender: true } },
    },
  } as const;

  const memberships = await prisma.clubMember.findMany({
    where: { playerId: user.id },
    include: {
      club: {
        include: {
          _count: { select: { members: true, events: true } },
          members: leaderMembers,
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

// Create a new club. Requires either app admin OR the player's
// `canCreateClubs` flag (granted by an app admin from the players
// admin panel). Regular users get 403.
export async function POST(req: Request) {
  let user;
  try {
    user = await requireClubCreator();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") {
      return NextResponse.json(
        { error: "You don't have permission to create clubs. Ask an app admin to grant the 'canCreateClubs' flag on your profile." },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, shortName, description, city, country, status, locations } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const cleanShortName = typeof shortName === "string" && shortName.trim()
    ? shortName.trim().slice(0, 20)
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
