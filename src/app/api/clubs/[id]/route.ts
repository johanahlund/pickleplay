import { prisma } from "@/lib/db";
import { requireAuth, canSeeEmails, stripEmailsDeep, getViewerMemberships, canSeeWhatsApp } from "@/lib/auth";
import { NextResponse } from "next/server";

// Get club details (login required; emails stripped for non-owners/non-admins)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;
  const club = await prisma.club.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          player: {
            select: {
              id: true, name: true, emoji: true, rating: true, gender: true,
              phone: true, photoUrl: true, wins: true, losses: true, role: true,
              whatsappVisibility: true,
              passwordHash: true,
              invitesSent: true,
              lastInvitedAt: true,
              canCreateLeagues: true,
              canCreateClubs: true,
              clubMembers: { select: { clubId: true } },
              leagueTeamPlayers: { select: { teamId: true } },
              eventPlayers: { select: { eventId: true } },
            },
          },
        },
        orderBy: { player: { name: "asc" } },
      },
      whatsappGroups: { orderBy: { name: "asc" } },
      locations: { orderBy: { name: "asc" } },
      _count: { select: { events: true } },
    },
  });

  if (!club) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Gate phone per-member via the target's whatsappVisibility setting.
  // Strip the per-target membership lists from the response — they're
  // only fetched to feed canSeeWhatsApp and shouldn't leak to the client.
  const viewerMemberships = await getViewerMemberships(user.id, user.role);
  type RawMemberPlayer = {
    id: string; name: string; emoji: string; rating: number; gender: string | null;
    phone: string | null; photoUrl: string | null; wins: number; losses: number; role: string;
    whatsappVisibility: string;
    passwordHash: string | null;
    invitesSent: number;
    lastInvitedAt: Date | null;
    canCreateLeagues: boolean;
    canCreateClubs: boolean;
    clubMembers: { clubId: string }[];
    leagueTeamPlayers: { teamId: string }[];
    eventPlayers: { eventId: string }[];
  };
  const scrubbed = {
    ...club,
    members: club.members.map((m) => {
      const player = m.player as RawMemberPlayer;
      const allowWhatsApp = canSeeWhatsApp(viewerMemberships, {
        id: player.id,
        whatsappVisibility: player.whatsappVisibility,
        clubIds: player.clubMembers.map((c) => c.clubId),
        teamIds: player.leagueTeamPlayers.map((t) => t.teamId),
        signedUpEventIds: player.eventPlayers.map((e) => e.eventId),
      });
      const { clubMembers: _cm, leagueTeamPlayers: _lt, eventPlayers: _ep, whatsappVisibility: _vis, phone, passwordHash, ...rest } = player;
      void _cm; void _lt; void _ep; void _vis;
      return {
        ...m,
        player: {
          ...rest,
          phone: allowWhatsApp ? phone : null,
          hasAccount: !!passwordHash,
        },
      };
    }),
  };

  const allowed = await canSeeEmails(user.id, user.role);
  return NextResponse.json(allowed ? scrubbed : stripEmailsDeep(scrubbed));
}

// Update club
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAuth();

  // Allowed: app admin (regardless of membership), OR a member of this
  // club whose role is owner/admin. The previous check short-circuited
  // on `!member` and locked app admins out of clubs they hadn't joined.
  if (user.role !== "admin") {
    const member = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: id, playerId: user.id } },
    });
    if (!member || (member.role !== "owner" && member.role !== "admin")) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  const { name, shortName, emoji, description, city, country, status, locations } = await req.json();
  const data: { name?: string; shortName?: string | null; emoji?: string; description?: string | null; city?: string | null; country?: string | null; status?: string } = {};
  if (name?.trim()) data.name = name.trim();
  if (shortName !== undefined) {
    data.shortName = typeof shortName === "string" && shortName.trim()
      ? shortName.trim().slice(0, 20)
      : null;
  }
  if (emoji) data.emoji = emoji;
  if (description !== undefined) data.description = description?.trim() || null;
  if (city !== undefined) data.city = city?.trim() || null;
  if (country !== undefined) data.country = country?.trim() || null;
  if (status !== undefined && ["draft", "active", "closed"].includes(status)) data.status = status;

  const club = await prisma.club.update({ where: { id }, data });

  // Handle locations if provided: replace all
  if (locations !== undefined && Array.isArray(locations)) {
    await prisma.clubLocation.deleteMany({ where: { clubId: id } });
    for (const loc of locations) {
      if (loc.name?.trim()) {
        const courts = Number(loc.numCourts);
        await prisma.clubLocation.create({
          data: {
            clubId: id,
            name: loc.name.trim(),
            googleMapsUrl: loc.googleMapsUrl?.trim() || null,
            numCourts: Number.isFinite(courts) && courts > 0 ? Math.min(courts, 20) : 2,
          },
        });
      }
    }
  }

  return NextResponse.json(club);
}

// Delete club
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAuth();

  // Allowed: app admin (regardless of membership), OR the club owner.
  if (user.role !== "admin") {
    const member = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: id, playerId: user.id } },
    });
    if (!member || member.role !== "owner") {
      return NextResponse.json({ error: "Only the club owner can delete" }, { status: 403 });
    }
  }

  await prisma.club.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
