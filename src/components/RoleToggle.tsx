"use client";

import { useSession } from "next-auth/react";
import { useState, createContext, useContext } from "react";

type ViewRole = "admin" | "user";

interface RoleContextType {
  viewRole: ViewRole;
  setViewRole: (role: ViewRole) => void;
  isAdminViewing: boolean; // true if user IS admin but viewing as user
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

  // Only admins can toggle
  const effectiveRole = isAdmin ? viewRole : "user";
  const isAdminViewing = isAdmin && viewRole === "user";

  return (
    <RoleContext.Provider value={{ viewRole: effectiveRole, setViewRole, isAdminViewing }}>
      {children}
    </RoleContext.Provider>
  );
}

/** Floating pill toggle — only visible to admins */
export function RoleTogglePill() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const { viewRole, setViewRole } = useViewRole();

  if (!isAdmin) return null;

  return (
    <button
      onClick={() => setViewRole(viewRole === "admin" ? "user" : "admin")}
      className={`fixed bottom-20 right-4 z-50 px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg transition-all ${
        viewRole === "admin"
          ? "bg-red-600 text-white"
          : "bg-green-600 text-white"
      }`}
    >
      {viewRole === "admin" ? "👁 Admin" : "👤 User View"}
    </button>
  );
}
