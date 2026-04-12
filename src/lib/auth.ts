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

/**
 * Recursively strips `email` (and any `email`-keyed property) from a JSON-shaped
 * object/array. Mutates a deep clone — does NOT modify the input.
 */
export function stripEmailsDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => stripEmailsDeep(v)) as unknown as T;
  if (typeof value === "object") {
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
  return session.user as { id: string; name: string; email: string; role: string; emoji: string };
}

/** Get the current session user and verify admin role, or return 403 */
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return user;
}

/** Check if the current user can manage the given event (admin, owner, or helper) */
export async function requireEventManager(eventId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { createdById: true },
  });
  if (event?.createdById === user.id) return user;

  const helper = await prisma.eventHelper.findFirst({
    where: { eventId, playerId: user.id },
  });
  if (helper) return user;

  throw new Error("Forbidden");
}

/** Check if the current user can manage the given league (admin, director, deputy, or helper) */
export async function requireLeagueManager(leagueId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { createdById: true, deputyId: true },
  });
  if (!league) throw new Error("NotFound");
  if (league.createdById === user.id) return user;
  if (league.deputyId === user.id) return user;

  const helper = await prisma.leagueHelper.findFirst({
    where: { leagueId, playerId: user.id },
  });
  if (helper) return user;

  throw new Error("Forbidden");
}

/** Check if the current user is the league director (admin or createdBy) — not deputy/helper. */
export async function requireLeagueOwner(leagueId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { createdById: true },
  });
  if (!league) throw new Error("NotFound");
  if (league.createdById === user.id) return user;

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
