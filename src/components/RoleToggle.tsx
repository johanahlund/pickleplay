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

const ROLES: { value: ViewRole; label: string; icon: string }[] = [
  { value: "admin", label: "Admin", icon: "★" },
  { value: "club", label: "Club", icon: "🏠" },
  { value: "event", label: "Event", icon: "📋" },
  { value: "user", label: "User", icon: "👤" },
];

/** Small role toggle — fixed top-right, only visible to admins */
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
  const isViewingAsNonAdmin = viewRole !== "admin";

  return (
    <div className="fixed left-[100px] z-[60]" style={{ top: "calc(max(env(safe-area-inset-top, 0px), 12px) + 13px)" }} ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-7 h-7 rounded-full text-[10px] font-bold shadow-md flex items-center justify-center transition-all ${
          isViewingAsNonAdmin ? "bg-amber-500 text-white ring-2 ring-amber-300" : "bg-green-600 text-white"
        }`}
        title={`Viewing as: ${current.label}`}
      >
        {current.icon}
      </button>
      {open && (
        <div className="absolute top-8 left-0 bg-white rounded-xl shadow-xl border border-border overflow-hidden min-w-[130px]">
          <div className="px-3 py-1.5 text-[9px] text-muted uppercase tracking-wider border-b border-border">View as</div>
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => { setViewRole(r.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                viewRole === r.value ? "bg-green-50" : ""
              }`}
            >
              <span>{r.icon}</span>
              <span>{r.label}</span>
              {viewRole === r.value && <span className="ml-auto text-green-600">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
