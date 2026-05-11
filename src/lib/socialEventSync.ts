import { prisma } from "@/lib/db";

/**
 * Returns the social-side Event for a given league event, or null when
 * the league event has no linked social event. The social event is the
 * Event row whose `socialOfEventId` points back at the league event.
 */
export async function findSocialEvent(leagueEventId: string) {
  return prisma.event.findFirst({
    where: { socialOfEventId: leagueEventId },
    select: { id: true, classes: { select: { id: true, isDefault: true }, orderBy: { isDefault: "desc" } } },
  });
}

/**
 * Decide whether a league-event sign-up should mirror to the social
 * event. Mirrors when the player will actually play casually:
 *   - intent ∈ { "playing", "social" }
 *   - status != "unavailable"
 * Attending-only and unavailable players do NOT mirror.
 */
export function shouldMirrorToSocial(
  status: string,
  prefs: Record<string, unknown> | null | undefined,
): boolean {
  if (status === "unavailable") return false;
  const intent = typeof prefs?._intent === "string" ? prefs._intent : null;
  if (intent === "attending") return false;
  if (intent === "social" || intent === "playing") return true;
  // No sentinel: assume "playing" if any per-category prefer/ok is set.
  if (prefs) {
    for (const [k, v] of Object.entries(prefs)) {
      if (k === "_intent" || k === "_guestTeamId") continue;
      if (v && typeof v === "object" && "level" in v) {
        const lvl = (v as { level?: string }).level;
        if (lvl === "prefer" || lvl === "ok") return true;
      }
    }
  }
  return false;
}

/**
 * Mirror a single player's league-event sign-up to the linked social
 * event. Upserts the EventPlayer on the social event when the player
 * qualifies; deletes it when they don't. No-op when the league event
 * has no social side.
 */
export async function syncPlayerToSocial(
  leagueEventId: string,
  playerId: string,
  status: string,
  prefs: Record<string, unknown> | null | undefined,
): Promise<void> {
  const social = await findSocialEvent(leagueEventId);
  if (!social) return;
  const wantsMirror = shouldMirrorToSocial(status, prefs);
  if (wantsMirror) {
    const existing = await prisma.eventPlayer.findFirst({
      where: { eventId: social.id, playerId },
      select: { id: true },
    });
    if (existing) {
      await prisma.eventPlayer.update({
        where: { id: existing.id },
        data: { status: "registered" },
      });
    } else {
      const defaultClassId = social.classes[0]?.id ?? null;
      await prisma.eventPlayer.create({
        data: { eventId: social.id, playerId, classId: defaultClassId, status: "registered" },
      });
    }
  } else {
    await prisma.eventPlayer.deleteMany({
      where: { eventId: social.id, playerId },
    });
  }
}

/**
 * Backfill the social event with every qualifying current league-event
 * sign-up. Called once when the operator toggles the social side ON.
 */
export async function backfillSocialEvent(leagueEventId: string): Promise<{ added: number }> {
  const social = await findSocialEvent(leagueEventId);
  if (!social) return { added: 0 };
  const signups = await prisma.eventPlayer.findMany({
    where: { eventId: leagueEventId },
    select: { playerId: true, status: true, signupPreferences: true },
  });
  const defaultClassId = social.classes[0]?.id ?? null;
  let added = 0;
  for (const s of signups) {
    const prefs = (s.signupPreferences as Record<string, unknown> | null) ?? null;
    if (!shouldMirrorToSocial(s.status, prefs)) continue;
    const existing = await prisma.eventPlayer.findFirst({
      where: { eventId: social.id, playerId: s.playerId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.eventPlayer.create({
        data: { eventId: social.id, playerId: s.playerId, classId: defaultClassId, status: "registered" },
      });
      added++;
    }
  }
  return { added };
}
