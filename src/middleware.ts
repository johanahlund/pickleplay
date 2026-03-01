export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect everything except: auth pages, API auth/register routes, static assets
    "/((?!signin|register|api/auth|api/register|_next|favicon|icon|manifest|.*\\.).*)",
  ],
};
