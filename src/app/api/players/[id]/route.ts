import { prisma } from "@/lib/db";
import { requireAuth, requireAdmin, canSeeEmails } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;
  const player = await prisma.player.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, phone: true, gender: true, photoUrl: true, rating: true, emoji: true },
  });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Strip email unless viewer is the player themselves, admin, or club owner/admin
  const isSelf = user.id === id;
  const allowEmail = isSelf || (await canSeeEmails(user.id, user.role));
  if (!allowEmail) {
    const { email: _e, ...rest } = player;
    void _e;
    return NextResponse.json(rest);
  }
  return NextResponse.json(player);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Only admins can delete players" }, { status: 403 });
  }
  const { id } = await params;
  await prisma.player.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;
  // Authorization: self / app admin / the person who originally added this
  // player / any club owner-admin of a club the player belongs to / any
  // captain or vice-captain of a league team the player is on. Narrower than
  // canAddPlayer because edits can land on existing players too — we want
  // the rule to match "I'm responsible for this player".
  const isSelf = user.id === id;
  const isAdmin = user.role === "admin";
  if (!isSelf && !isAdmin) {
    const target = await prisma.player.findUnique({
      where: { id },
      select: {
        addedById: true,
        clubMembers: { select: { clubId: true } },
        leagueTeamPlayers: { select: { teamId: true } },
      },
    });
    if (!target) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    let allowed = target.addedById === user.id;
    if (!allowed && target.clubMembers.length > 0) {
      const clubIds = target.clubMembers.map((m) => m.clubId);
      const clubAdmin = await prisma.clubMember.findFirst({
        where: { clubId: { in: clubIds }, playerId: user.id, role: { in: ["owner", "admin"] } },
        select: { id: true },
      });
      if (clubAdmin) allowed = true;
    }
    if (!allowed && target.leagueTeamPlayers.length > 0) {
      const teamIds = target.leagueTeamPlayers.map((tp) => tp.teamId);
      const teamCap = await prisma.leagueTeam.findFirst({
        where: { id: { in: teamIds }, OR: [{ captainId: user.id }, { viceCaptainId: user.id }] },
        select: { id: true },
      });
      if (teamCap) allowed = true;
    }
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  const { name, emoji, gender, phone, email, canCreateLeagues, canCreateClubs, country } = await req.json();

  const data: { name?: string; emoji?: string; gender?: string | null; phone?: string | null; email?: string | null; canCreateLeagues?: boolean; canCreateClubs?: boolean; country?: string | null } = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    const cleanName = name.trim();
    // Uniqueness check: no other active player with this name (case-insensitive).
    // Skip the check if the name hasn't actually changed.
    const existing = await prisma.player.findFirst({
      where: {
        name: { equals: cleanName, mode: "insensitive" },
        status: { not: "voided" },
        NOT: { id },
      },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A player named "${existing.name}" already exists. Pick a different name.` },
        { status: 409 },
      );
    }
    data.name = cleanName;
  }
  if (emoji !== undefined) {
    data.emoji = emoji;
  }
  if (gender !== undefined) {
    if (gender !== null && gender !== "M" && gender !== "F") {
      return NextResponse.json({ error: "Gender must be M, F, or null" }, { status: 400 });
    }
    data.gender = gender;
  }
  if (phone !== undefined) {
    data.phone = phone ? phone.trim() : null;
  }
  if (email !== undefined) {
    data.email = email ? email.trim().toLowerCase() : null;
  }
  if (canCreateLeagues !== undefined) {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only app admins can grant league creation" }, { status: 403 });
    }
    data.canCreateLeagues = !!canCreateLeagues;
  }
  if (canCreateClubs !== undefined) {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Only app admins can grant club creation" }, { status: 403 });
    }
    data.canCreateClubs = !!canCreateClubs;
  }
  if (country !== undefined) {
    // Whitelist against the canonical country list. Strings are stored
    // as the display name (e.g., "Portugal") to match the existing
    // Club.country column. Empty string / null clears the field.
    if (country === null || country === "") {
      data.country = null;
    } else if (typeof country === "string") {
      const { COUNTRIES } = await import("@/lib/countries");
      if ((COUNTRIES as readonly string[]).includes(country)) {
        data.country = country;
      } else {
        return NextResponse.json({ error: "Unknown country" }, { status: 400 });
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  const player = await prisma.player.update({
    where: { id },
    data,
  });

  return NextResponse.json(player);
}
