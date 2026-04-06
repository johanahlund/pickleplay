import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

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
