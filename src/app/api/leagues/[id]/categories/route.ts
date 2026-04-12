import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: add a category
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, format, gender, ageGroup, skillMin, skillMax, scoringFormat, winBy } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const count = await prisma.leagueCategory.count({ where: { leagueId: id } });
  const cat = await prisma.leagueCategory.create({
    data: {
      leagueId: id,
      name: name.trim(),
      format: format || "doubles",
      gender: gender || "open",
      ageGroup: ageGroup || "open",
      skillMin: skillMin ?? null,
      skillMax: skillMax ?? null,
      scoringFormat: scoringFormat || "3x11",
      winBy: winBy || "2",
      sortOrder: count,
    },
  });
  return NextResponse.json(cat);
}

// PATCH: update a category
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { categoryId, ...data } = await req.json();
  if (!categoryId) return NextResponse.json({ error: "categoryId required" }, { status: 400 });

  const cat = await prisma.leagueCategory.update({ where: { id: categoryId }, data });
  return NextResponse.json(cat);
}

// DELETE: remove a category
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { categoryId } = await req.json();
  await prisma.leagueCategory.delete({ where: { id: categoryId } });
  return NextResponse.json({ ok: true });
}
