import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight middleware — just checks for session token cookie.
// Full auth validation happens in API routes via requireAuth().
// This avoids bundling Prisma/bcrypt into the edge function.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes that don't need auth
  const publicPaths = ["/signin", "/register", "/api/auth", "/api/register"];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for session token (set by NextAuth)
  const token =
    request.cookies.get("authjs.session-token")?.value ||
    request.cookies.get("__Secure-authjs.session-token")?.value;

  if (!token) {
    const signinUrl = new URL("/signin", request.url);
    signinUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signinUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match pages but not static files or Next.js internals
    "/((?!_next|favicon|icon|manifest|.*\\.).*)",
  ],
};
