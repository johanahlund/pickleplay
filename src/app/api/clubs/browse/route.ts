import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: browse all clubs (login required)
export async function GET(req: Request) {
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const url = new URL(req.url);
  const search = url.searchParams.get("q") || "";
  const city = url.searchParams.get("city") || "";
  const country = url.searchParams.get("country") || "";

  // If requesting just countries list
  if (url.searchParams.get("countries") === "1") {
    const all = await prisma.club.findMany({ where: { country: { not: null } }, select: { country: true }, distinct: ["country"] });
    const list = all.map((c) => c.country).filter(Boolean).sort();
    return NextResponse.json(list);
  }

  const clubs = await prisma.club.findMany({
    where: {
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      ...(city ? { city: { contains: city, mode: "insensitive" as const } } : {}),
      ...(country ? { country: { contains: country, mode: "insensitive" as const } } : {}),
    },
    include: {
      _count: { select: { members: true, events: true } },
      locations: true,
    },
    orderBy: { name: "asc" },
    take: 50,
  });

  return NextResponse.json(clubs.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    logoUrl: c.logoUrl,
    coverUrl: c.coverUrl,
    description: c.description,
    memberCount: c._count.members,
    eventCount: c._count.events,
    city: c.city,
    country: c.country,
    locations: c.locations,
  })));
}
