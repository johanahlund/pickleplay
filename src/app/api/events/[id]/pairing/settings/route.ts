import { prisma } from "@/lib/db";
import { requireEventManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * PUT /api/events/[id]/pairing/settings
 *
 * Persist the PairingSettings JSON on an EventClass. Called by the pairing
 * configurator UI whenever the organizer changes a setting (debounced from
 * the client side). Settings are stored as-is; the generate-round and
 * analyze endpoints already know how to coerce them into full solver input.
 *
 * Body: { classId: string, settings: PairingSettings }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null) as {
    classId?: string;
    settings?: unknown;
  } | null;
  if (!body?.classId || !body.settings) {
    return NextResponse.json({ error: "classId and settings required" }, { status: 400 });
  }

  // Whitelist allowed top-level keys and shapes.
  const s = body.settings as Record<string, unknown>;
  const cleaned = {
    base: validString(s.base, ["random", "swiss", "king", "manual"], "random"),
    teams: validString(s.teams, ["fixed", "rotating"], "rotating"),
    gender: validString(s.gender, ["mixed", "random", "same"], "random"),
    skillWindow: validWindow(s.skillWindow),
    matchCountWindow: validWindow(s.matchCountWindow),
    varietyWindow: validWindow(s.varietyWindow),
  };

  // Verify the class belongs to this event.
  const cls = await prisma.eventClass.findUnique({
    where: { id: body.classId },
    select: { eventId: true },
  });
  if (!cls) return NextResponse.json({ error: "Class not found" }, { status: 404 });
  if (cls.eventId !== id) {
    return NextResponse.json({ error: "Class does not belong to this event" }, { status: 403 });
  }

  await prisma.eventClass.update({
    where: { id: body.classId },
    data: { pairingSettings: cleaned },
  });

  return NextResponse.json({ ok: true, settings: cleaned });
}

function validString<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  if (typeof v === "string" && (allowed as string[]).includes(v)) return v as T;
  return fallback;
}

/**
 * A window can be a non-negative integer or the "inf" sentinel (we can't
 * JSON-serialize Infinity). Anything else falls back to ±1.
 */
function validWindow(v: unknown): number | "inf" {
  if (v === "inf" || v === "infinity") return "inf";
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10) {
    return Math.round(v);
  }
  return 1;
}
