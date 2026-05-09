import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

// POST: upload (or replace) the league's rules PDF.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const league = await prisma.league.findUnique({
    where: { id },
    select: { rulesPdfUrl: true },
  });
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Must be a PDF" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Max ${MAX_BYTES / (1024 * 1024)}MB` }, { status: 400 });
  }

  // Delete prior PDF (best-effort)
  if (league.rulesPdfUrl) {
    try { await del(league.rulesPdfUrl); } catch { /* ignore */ }
  }

  const blob = await put(`leagues/${id}-rules-${Date.now()}.pdf`, file, {
    access: "public",
    contentType: "application/pdf",
  });

  await prisma.league.update({ where: { id }, data: { rulesPdfUrl: blob.url } });
  return NextResponse.json({ url: blob.url });
}

// DELETE: remove the rules PDF.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const league = await prisma.league.findUnique({
    where: { id },
    select: { rulesPdfUrl: true },
  });
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.rulesPdfUrl) {
    try { await del(league.rulesPdfUrl); } catch { /* ignore */ }
  }
  await prisma.league.update({ where: { id }, data: { rulesPdfUrl: null } });
  return NextResponse.json({ ok: true });
}
