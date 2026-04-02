import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Delete a post (author or club admin)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id, postId } = await params;

  const post = await prisma.clubPost.findUnique({ where: { id: postId } });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Allow author or club admin/owner
  if (post.authorId !== user.id && user.role !== "admin") {
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: id, playerId: user.id } },
    });
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  await prisma.clubPost.delete({ where: { id: postId } });
  return NextResponse.json({ ok: true });
}
