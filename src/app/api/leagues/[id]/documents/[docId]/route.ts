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
