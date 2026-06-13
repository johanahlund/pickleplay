"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";
import Logo from "./Logo";

const defaultTabs = [
  { href: "/players", label: "Players", iconName: "players", iconOnly: true },
  { href: "/clubs", label: "Clubs", iconName: "clubs" },
  { href: "/leagues", label: "Leagues", iconName: "trophy" },
  { href: "/events", label: "Events", iconName: "calendar" },
  { href: "/matches", label: "My Matches", iconName: "paddle" },
];

const HIDDEN_PATHS = ["/signin", "/register", "/claim", "/reset"];

// The current-event quick-jump lives in <CurrentEventFab> (bottom-right),
// not as a nav tab anymore.
export function BottomNav() {
  const pathname = usePathname();

  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-[600px] mx-auto flex justify-around items-center h-16">
        {defaultTabs.map((tab) => {
          const tabPath = tab.href.split("?")[0];
          const isActive =
            tabPath === "/"
              ? pathname === "/"
              : pathname === tabPath || pathname.startsWith(tabPath + "/");
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
              <Icon name={tab.iconName} size={24} color={isActive ? "#2563EB" : "#6B7280"} />
              {!tab.iconOnly && <span className="text-[11px]">{tab.label}</span>}
            </Link>
          );
        })}
      </div>
      {/* Brand mark — moved out of the top headers to a footer strip under the
          nav. Subtle by design; sits above the safe-area inset. */}
      <div className="max-w-[600px] mx-auto flex items-center justify-center border-t border-border/60 py-1.5">
        <Logo size={15} color="#15803d" ball="pickle" ballAlign="midline" />
      </div>
    </nav>
  );
}
