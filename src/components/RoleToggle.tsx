"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useRef, createContext, useContext } from "react";

type ViewRole = "admin" | "club" | "event" | "user";

const ROLE_LEVELS: Record<ViewRole, number> = {
  user: 0,
  event: 1,
  club: 2,
  admin: 3,
};

/** Check if the current viewRole meets the minimum required level */
export function hasRole(viewRole: ViewRole, minRole: ViewRole): boolean {
  return ROLE_LEVELS[viewRole] >= ROLE_LEVELS[minRole];
}

interface RoleContextType {
  viewRole: ViewRole;
  setViewRole: (role: ViewRole) => void;
  isAdminViewing: boolean;
}

const RoleContext = createContext<RoleContextType>({
  viewRole: "admin",
  setViewRole: () => {},
  isAdminViewing: false,
});

export function useViewRole() {
  return useContext(RoleContext);
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const [viewRole, setViewRole] = useState<ViewRole>("admin");

  const effectiveRole: ViewRole = isAdmin ? viewRole : "user";
  const isAdminViewing = isAdmin && viewRole === "user";

  return (
    <RoleContext.Provider value={{ viewRole: effectiveRole, setViewRole, isAdminViewing }}>
      {children}
    </RoleContext.Provider>
  );
}

const ROLES: { value: ViewRole; label: string; icon: string; color: string }[] = [
  { value: "admin", label: "App Admin", icon: "🛡", color: "bg-red-600" },
  { value: "club", label: "Club Admin", icon: "🏠", color: "bg-purple-600" },
  { value: "event", label: "Event Admin", icon: "📋", color: "bg-blue-600" },
  { value: "user", label: "User", icon: "👤", color: "bg-green-600" },
];

/** Floating pill toggle — only visible to admins */
export function RoleTogglePill() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const { viewRole, setViewRole } = useViewRole();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!isAdmin) return null;

  const current = ROLES.find((r) => r.value === viewRole) || ROLES[0];

  return (
    <div className="fixed top-1 left-1/2 -translate-x-1/2 z-[60]" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`px-3 py-1 rounded-full text-[10px] font-semibold shadow-lg transition-all ${current.color} text-white`}
      >
        {current.icon} {current.label}
      </button>
      {open && (
        <div className="absolute top-8 right-0 bg-white rounded-xl shadow-xl border border-border overflow-hidden min-w-[140px]">
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => { setViewRole(r.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                viewRole === r.value ? "bg-gray-100" : ""
              }`}
            >
              <span>{r.icon}</span>
              <span>{r.label}</span>
              {viewRole === r.value && <span className="ml-auto text-action">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
