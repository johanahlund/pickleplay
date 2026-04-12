import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";
import { validateCategoryInput, validateCategoryPatch } from "@/lib/leagueCategories";

// POST: add a category
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  const v = validateCategoryInput(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const count = await prisma.leagueCategory.count({ where: { leagueId: id } });
  const cat = await prisma.leagueCategory.create({
    data: { ...v.data, leagueId: id, sortOrder: count },
  });
  return NextResponse.json(cat);
}

// PATCH: update a category
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { categoryId, ...rest } = body as { categoryId?: string; [k: string]: unknown };
  if (!categoryId || typeof categoryId !== "string") {
    return NextResponse.json({ error: "categoryId required" }, { status: 400 });
  }

  const existing = await prisma.leagueCategory.findUnique({
    where: { id: categoryId },
    select: { leagueId: true },
  });
  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  if (existing.leagueId !== id) {
    return NextResponse.json({ error: "Category does not belong to this league" }, { status: 403 });
  }

  const v = validateCategoryPatch(rest);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (Object.keys(v.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const cat = await prisma.leagueCategory.update({
    where: { id: categoryId },
    data: v.data,
  });
  return NextResponse.json(cat);
}

// DELETE: remove a category
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  const categoryId = body && typeof body === "object" ? (body as { categoryId?: unknown }).categoryId : null;
  if (!categoryId || typeof categoryId !== "string") {
    return NextResponse.json({ error: "categoryId required" }, { status: 400 });
  }

  const existing = await prisma.leagueCategory.findUnique({
    where: { id: categoryId },
    select: { leagueId: true },
  });
  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  if (existing.leagueId !== id) {
    return NextResponse.json({ error: "Category does not belong to this league" }, { status: 403 });
  }

  await prisma.leagueCategory.delete({ where: { id: categoryId } });
  return NextResponse.json({ ok: true });
}
