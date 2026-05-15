import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * App-admin-only stats for the /players page. Currently returns
 * "how many accounts were activated in the last 24h / 7d", where
 * "activated" covers both self-registration and claim-via-invite
 * (driven by Player.accountActivatedAt, set by /api/register and
 * /api/claim).
 *
 * Non-admins get a 403 — the stat is fine to deny rather than
 * silently zero out, since the UI for non-admins doesn't render
 * the affordance at all.
 */
export async function GET() {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "App admin only" }, { status: 403 });
  }

  const now = Date.now();
  const since24h = new Date(now - 86_400_000);
  const since7d = new Date(now - 7 * 86_400_000);

  const [activated24h, activated7d] = await Promise.all([
    prisma.player.count({
      where: { status: "active", accountActivatedAt: { gte: since24h } },
    }),
    prisma.player.count({
      where: { status: "active", accountActivatedAt: { gte: since7d } },
    }),
  ]);

  return NextResponse.json({ activated24h, activated7d });
}
