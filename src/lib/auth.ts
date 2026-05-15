import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "./db";

/**
 * Returns true if the given user is allowed to see email addresses on
 * other users (app admin OR owner/admin of any club).
 */
export async function canSeeEmails(userId: string | null | undefined, role: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  if (role === "admin") return true;
  const m = await prisma.clubMember.findFirst({
    where: { playerId: userId, role: { in: ["owner", "admin"] } },
    select: { id: true },
  });
  return !!m;
}

// ── WhatsApp visibility ──
//
// Each player picks a tier on their profile. Tiers are cumulative —
// "clubMembers" implies "clubAdmins", and so on. Self + app admin always
// see the number regardless of tier.
//
//   none            — only self + app admin
//   clubAdmins      — + owners/admins of clubs the target is a member of
//   clubMembers     — + fellow club members + league teammates
//   eventOrganizers — + organizers of events the target is signed up for
//   everyone        — any authenticated user
export type WhatsAppVisibility =
  | "none"
  | "clubAdmins"
  | "clubMembers"
  | "eventOrganizers"
  | "everyone";

export const WHATSAPP_VISIBILITIES: WhatsAppVisibility[] = [
  "none",
  "clubAdmins",
  "clubMembers",
  "eventOrganizers",
  "everyone",
];

export type ViewerMemberships = {
  id: string;
  role: string;
  adminClubIds: Set<string>;
  memberClubIds: Set<string>;
  teamIds: Set<string>;
  organizedEventIds: Set<string>;
};

/**
 * Fetch the viewer's memberships in one round trip. Used by the
 * canSeeWhatsApp checker across list endpoints (players, club members,
 * event players). Cheap: four small queries on indexed columns.
 */
export async function getViewerMemberships(
  userId: string,
  role: string,
): Promise<ViewerMemberships> {
  const [clubMembers, teams, organizedEvents, eventHelpers] = await Promise.all([
    prisma.clubMember.findMany({
      where: { playerId: userId },
      select: { clubId: true, role: true },
    }),
    prisma.leagueTeamPlayer.findMany({
      where: { playerId: userId },
      select: { teamId: true },
    }),
    prisma.event.findMany({
      where: { createdById: userId },
      select: { id: true },
    }),
    prisma.eventHelper.findMany({
      where: { playerId: userId },
      select: { eventId: true },
    }),
  ]);
  const adminClubIds = new Set<string>();
  const memberClubIds = new Set<string>();
  for (const m of clubMembers) {
    memberClubIds.add(m.clubId);
    if (m.role === "owner" || m.role === "admin") adminClubIds.add(m.clubId);
  }
  return {
    id: userId,
    role,
    adminClubIds,
    memberClubIds,
    teamIds: new Set(teams.map((t) => t.teamId)),
    organizedEventIds: new Set([
      ...organizedEvents.map((e) => e.id),
      ...eventHelpers.map((h) => h.eventId),
    ]),
  };
}

export type WhatsAppTargetCtx = {
  id: string;
  whatsappVisibility: string | null | undefined;
  clubIds: string[];
  teamIds: string[];
  signedUpEventIds: string[];
};

/**
 * Decide whether `viewer` should see `target`'s WhatsApp number.
 * Pure function once memberships are fetched — safe to call in a tight
 * loop across hundreds of players.
 */
export function canSeeWhatsApp(viewer: ViewerMemberships, target: WhatsAppTargetCtx): boolean {
  if (viewer.id === target.id) return true;
  if (viewer.role === "admin") return true;

  // Default to the most-common tier for legacy rows that pre-date the
  // setting. Keep this in sync with the schema default.
  const tier = (target.whatsappVisibility || "clubMembers") as WhatsAppVisibility;
  if (tier === "everyone") return true;
  if (tier === "none") return false;

  const isClubAdmin = target.clubIds.some((c) => viewer.adminClubIds.has(c));
  if (tier === "clubAdmins") return isClubAdmin;

  const isClubMember = target.clubIds.some((c) => viewer.memberClubIds.has(c));
  const isTeammate = target.teamIds.some((t) => viewer.teamIds.has(t));
  if (tier === "clubMembers") return isClubAdmin || isClubMember || isTeammate;

  const isEventOrganizer = target.signedUpEventIds.some((e) => viewer.organizedEventIds.has(e));
  if (tier === "eventOrganizers") {
    return isClubAdmin || isClubMember || isTeammate || isEventOrganizer;
  }

  return false;
}

/**
 * Recursively strips `email` (and any `email`-keyed property) from a JSON-shaped
 * object/array. Mutates a deep clone — does NOT modify the input.
 */
export function stripEmailsDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  // Preserve non-plain objects (Date, Buffer, etc.) as-is. Walking
  // their enumerable own properties drops the actual content — for
  // Date that meant the API silently emitted `{}` instead of the ISO
  // string, breaking every event-list date filter downstream.
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => stripEmailsDeep(v)) as unknown as T;
  if (typeof value === "object") {
    // Skip non-plain objects we don't recognise (e.g., Buffer, Map).
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "email") continue;
      out[k] = stripEmailsDeep(v);
    }
    return out as T;
  }
  return value;
}

/** Map an error thrown by require* helpers to the appropriate JSON response. */
export function authErrorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unauthorized";
  if (msg === "NotFound") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (msg === "Forbidden") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  return NextResponse.json({ error: "Login required" }, { status: 401 });
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null;

        const player = await prisma.player.findUnique({
          where: { email: (credentials.email as string).toLowerCase().trim() },
        });

        if (!player || !player.passwordHash) return null;
        if (player.status === "voided") return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          player.passwordHash
        );
        if (!valid) return null;

        return {
          id: player.id,
          email: player.email,
          name: player.name,
          role: player.role,
          emoji: player.emoji,
          canCreateLeagues: player.canCreateLeagues,
          canCreateClubs: player.canCreateClubs,
          country: player.country,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: string }).role;
        token.emoji = (user as unknown as { emoji: string }).emoji;
        token.canCreateLeagues = (user as unknown as { canCreateLeagues?: boolean }).canCreateLeagues ?? false;
        token.canCreateClubs = (user as unknown as { canCreateClubs?: boolean }).canCreateClubs ?? false;
        token.country = (user as unknown as { country?: string | null }).country ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = session.user as any;
        u.id = token.id;
        u.role = token.role;
        u.emoji = token.emoji;
        u.canCreateLeagues = token.canCreateLeagues ?? false;
        u.canCreateClubs = token.canCreateClubs ?? false;
        u.country = token.country ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
  session: { strategy: "jwt" },
});

/** Get the current session user or return 401 response */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user as { id: string; name: string; email: string; role: string; emoji: string; canCreateLeagues?: boolean };
}

/**
 * Check if the current user is allowed to create leagues. App admins always
 * can; other users require the canCreateLeagues flag (granted by app admin).
 * The session may be stale, so we re-read the flag from the DB.
 */
export async function requireLeagueCreator() {
  const user = await requireAuth();
  if (user.role === "admin") return user;
  const player = await prisma.player.findUnique({
    where: { id: user.id },
    select: { canCreateLeagues: true },
  });
  if (player?.canCreateLeagues) return user;
  throw new Error("Forbidden");
}

/**
 * Check if the current user is allowed to create clubs. App admins always
 * can; other users require the canCreateClubs flag (granted by app admin).
 * Re-reads from the DB to avoid relying on a possibly stale session.
 */
export async function requireClubCreator() {
  const user = await requireAuth();
  if (user.role === "admin") return user;
  const player = await prisma.player.findUnique({
    where: { id: user.id },
    select: { canCreateClubs: true },
  });
  if (player?.canCreateClubs) return user;
  throw new Error("Forbidden");
}

/** Get the current session user and verify admin role, or return 403 */
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return user;
}

/**
 * Stricter gate than `requireEventManager`: schedule edits on a
 * league event (start time, court, displayOrder, auto-arrange,
 * per-category duration overrides). Allowed:
 *   - app admin
 *   - event organizer (event.createdById)
 *   - league admin (league.createdById OR league.deputyId)
 *   - host team's captain/vice (league events only)
 *
 * Explicitly excludes event helpers and visitor-team captains —
 * schedule decisions belong to the host. Returns the user object
 * on success; throws "Forbidden" otherwise.
 */
export async function requireScheduleEditor(eventId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      createdById: true,
      hostTeamId: true,
      round: { select: { league: { select: { createdById: true, deputyId: true } } } },
    },
  });
  if (!event) throw new Error("NotFound");

  if (event.createdById === user.id) return user;

  const league = event.round?.league;
  if (league && (league.createdById === user.id || league.deputyId === user.id)) return user;

  if (event.hostTeamId) {
    const host = await prisma.leagueTeam.findUnique({
      where: { id: event.hostTeamId },
      select: { captainId: true, viceCaptainId: true },
    });
    if (host && (host.captainId === user.id || host.viceCaptainId === user.id)) return user;
  }

  throw new Error("Forbidden");
}

/** Check if the current user can manage the given event (admin, owner, helper,
 *  or league director/deputy if the event is part of a league match-day). */
export async function requireEventManager(eventId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      createdById: true,
      round: { select: { league: { select: { createdById: true, deputyId: true } } } },
    },
  });
  if (event?.createdById === user.id) return user;

  const helper = await prisma.eventHelper.findFirst({
    where: { eventId, playerId: user.id },
  });
  if (helper) return user;

  // League director/deputy override on league-attached events
  const league = event?.round?.league;
  if (league && (league.createdById === user.id || league.deputyId === user.id)) return user;

  throw new Error("Forbidden");
}

/**
 * Check if the current user can manage the given league. Allowed if:
 *   - app admin, OR
 *   - owner/admin of the league's organizing club, OR
 *   - the league director (createdBy), deputy, or a helper
 */
export async function requireLeagueManager(leagueId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { createdById: true, deputyId: true, clubId: true },
  });
  if (!league) throw new Error("NotFound");
  if (league.createdById === user.id) return user;
  if (league.deputyId === user.id) return user;

  if (league.clubId) {
    const clubMember = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: league.clubId, playerId: user.id } },
      select: { role: true },
    });
    if (clubMember && (clubMember.role === "owner" || clubMember.role === "admin")) return user;
  }

  const helper = await prisma.leagueHelper.findFirst({
    where: { leagueId, playerId: user.id },
  });
  if (helper) return user;

  throw new Error("Forbidden");
}

/**
 * Check if the current user is the league "owner" — the league director
 * (createdBy), OR an owner/admin of the league's organizing club, OR an
 * app admin. Used for sensitive operations (delete, transfer director,
 * manage helpers).
 */
export async function requireLeagueOwner(leagueId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { createdById: true, clubId: true },
  });
  if (!league) throw new Error("NotFound");
  if (league.createdById === user.id) return user;

  if (league.clubId) {
    const clubMember = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: league.clubId, playerId: user.id } },
      select: { role: true },
    });
    if (clubMember && (clubMember.role === "owner" || clubMember.role === "admin")) return user;
  }

  throw new Error("Forbidden");
}

/**
 * Allowed if the user is a league manager OR the captain / vice-captain of
 * the given team. Lets team leaders manage their own roster without giving
 * them league-wide management rights.
 */
export async function requireTeamRosterManager(teamId: string, leagueId: string) {
  const user = await requireAuth();
  // Try league manager first
  if (user.role === "admin") return user;

  const [league, team] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { createdById: true, deputyId: true, clubId: true },
    }),
    prisma.leagueTeam.findUnique({
      where: { id: teamId },
      select: { captainId: true, viceCaptainId: true, leagueId: true },
    }),
  ]);
  if (!league) throw new Error("NotFound");
  if (!team || team.leagueId !== leagueId) throw new Error("NotFound");

  if (team.captainId === user.id) return user;
  if (team.viceCaptainId === user.id) return user;
  if (league.createdById === user.id) return user;
  if (league.deputyId === user.id) return user;

  if (league.clubId) {
    const clubMember = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: league.clubId, playerId: user.id } },
      select: { role: true },
    });
    if (clubMember && (clubMember.role === "owner" || clubMember.role === "admin")) return user;
  }

  const helper = await prisma.leagueHelper.findFirst({
    where: { leagueId, playerId: user.id },
  });
  if (helper) return user;

  throw new Error("Forbidden");
}

/**
 * Check if the current user is an owner or admin of the given club, or an
 * app admin. Used to gate league creation and editing to club leadership.
 */
export async function requireClubOwner(clubId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;
  const member = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId, playerId: user.id } },
    select: { role: true },
  });
  if (!member) throw new Error("NotFound");
  if (member.role === "owner" || member.role === "admin") return user;
  throw new Error("Forbidden");
}

/** Check if the current user is the event owner (not just a helper) */
export async function requireEventOwner(eventId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { createdById: true },
  });
  if (event?.createdById === user.id) return user;

  throw new Error("Forbidden");
}
