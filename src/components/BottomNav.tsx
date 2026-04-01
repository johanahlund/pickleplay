"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/players", label: "Players", icon: "👥" },
  { href: "/events", label: "Events", icon: "🏸" },
  { href: "/matches", label: "Matches", icon: "🏓" },
  { href: "/leaderboard", label: "Rankings", icon: "🏆" },
];

const HIDDEN_PATHS = ["/signin", "/register", "/claim", "/reset"];

export function BottomNav() {
  const pathname = usePathname();

  // Hide nav on auth/claim pages
  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border">
      <div className="max-w-[600px] mx-auto flex justify-around items-center h-16">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className="text-[11px]">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
