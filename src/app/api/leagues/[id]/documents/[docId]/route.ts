import { del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// DELETE: remove a document (also deletes the blob).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const doc = await prisma.leagueDocument.findUnique({
    where: { id: docId },
    select: { leagueId: true, url: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (doc.leagueId !== id) {
    return NextResponse.json({ error: "Document does not belong to this league" }, { status: 403 });
  }

  try { await del(doc.url); } catch { /* ignore — orphan blob is fine */ }
  await prisma.leagueDocument.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}

// PATCH: toggle metadata flags on a document (currently: includeInAssistant).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const doc = await prisma.leagueDocument.findUnique({
    where: { id: docId },
    select: { leagueId: true, mimeType: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (doc.leagueId !== id) {
    return NextResponse.json({ error: "Document does not belong to this league" }, { status: 403 });
  }

  let body: { includeInAssistant?: boolean; showToUsers?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const data: { includeInAssistant?: boolean; showToUsers?: boolean } = {};
  if (typeof body.includeInAssistant === "boolean") {
    if (body.includeInAssistant && doc.mimeType !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF documents can be included in the assistant" }, { status: 400 });
    }
    data.includeInAssistant = body.includeInAssistant;
  }
  if (typeof body.showToUsers === "boolean") {
    data.showToUsers = body.showToUsers;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.leagueDocument.update({ where: { id: docId }, data });
  return NextResponse.json(updated);
}
