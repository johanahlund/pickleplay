"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

const APP_VERSION = "1.0.0";
const HIDDEN_PATHS = ["/signin", "/register", "/claim"];

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const isAuthPage = HIDDEN_PATHS.some((p) => pathname.startsWith(p));

  return (
    <header className="sticky top-0 z-50 bg-primary text-white px-4 py-3 shadow-md">
      <div className="max-w-[600px] mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">🏓 PickleJ</h1>
          <span className="text-[10px] opacity-60 font-mono">v{APP_VERSION}</span>
        </div>
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
