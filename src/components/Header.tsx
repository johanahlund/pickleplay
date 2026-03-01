"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

const AUTH_PATHS = ["/signin", "/register"];

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const isAuthPage = AUTH_PATHS.includes(pathname);

  return (
    <header className="sticky top-0 z-50 bg-primary text-white px-4 py-3 shadow-md">
      <div className="max-w-[600px] mx-auto flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">🏓 PicklePlay</h1>
        {!isAuthPage && session?.user && (
          <div className="flex items-center gap-2">
            <span className="text-sm opacity-90">
              {session.user.emoji} {session.user.name}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/signin" })}
              className="text-xs bg-white/20 px-2 py-1 rounded-md hover:bg-white/30 transition-colors"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
