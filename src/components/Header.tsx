"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { AppHeader } from "./AppHeader";

const APP_VERSION = "5.3.0";
const HIDDEN_PATHS = ["/signin", "/register", "/claim", "/reset"];
const EVENT_DETAIL_RE = /^\/events\/[^/]+(\/.*)?$/;

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to change password");
        return;
      }
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="text-lg font-bold text-foreground mb-4">
          Change Password
        </h2>
        {success ? (
          <p className="text-green-600 font-medium">Password updated!</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              required
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              required
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              required
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border text-muted hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-action-dark text-white font-medium hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Update"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<{ id: string; title: string; body?: string | null; linkUrl?: string | null; read: boolean; createdAt: string }[]>([]);
  const headerRef = useRef<HTMLElement>(null);

  const [clubName, setClubName] = useState<string | null>(null);
  const [clubEmoji, setClubEmoji] = useState<string | null>(null);
  const [clubLogoUrl, setClubLogoUrl] = useState<string | null>(null);

  // Dynamically set main content padding based on header height
  const updateMainPadding = useCallback(() => {
    if (headerRef.current) {
      const h = headerRef.current.offsetHeight;
      const main = document.getElementById("main-content");
      if (main) main.style.paddingTop = `${h}px`;
      document.documentElement.style.setProperty("--header-height", `${h}px`);
    }
  }, []);

  useEffect(() => {
    updateMainPadding();
    const observer = new ResizeObserver(updateMainPadding);
    if (headerRef.current) observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, [updateMainPadding, clubName]);

  const isAuthPage = HIDDEN_PATHS.some((p) => pathname.startsWith(p));

  // Poll for unread notifications
  useEffect(() => {
    if (!session?.user) return;
    const check = () => {
      fetch("/api/notifications").then((r) => r.ok ? r.json() : []).then((data) => {
        if (Array.isArray(data)) {
          setNotifications(data);
          setUnreadCount(data.filter((n: { read: boolean }) => !n.read).length);
        }
      }).catch(() => {});
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [session?.user]);
  const isClubsListPage = pathname === "/clubs";

  // Detect if we're inside a club from the URL
  const clubMatch = pathname.match(/^\/clubs\/([^/]+)/);
  const urlClubId = clubMatch?.[1];

  // Persist active club in sessionStorage
  useEffect(() => {
    if (urlClubId) {
      // Entering a club — save it
      sessionStorage.setItem("activeClubId", urlClubId);
      fetch(`/api/clubs/${urlClubId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) {
            setClubName(data.name);
            setClubEmoji(data.emoji);
            setClubLogoUrl(data.logoUrl || null);
            sessionStorage.setItem("activeClubName", data.name);
            sessionStorage.setItem("activeClubEmoji", data.emoji);
            if (data.logoUrl) sessionStorage.setItem("activeClubLogoUrl", data.logoUrl);
            else sessionStorage.removeItem("activeClubLogoUrl");
          }
        });
    } else if (isClubsListPage) {
      // Back at clubs list — clear context
      sessionStorage.removeItem("activeClubId");
      sessionStorage.removeItem("activeClubName");
      sessionStorage.removeItem("activeClubEmoji");
      setClubName(null);
      setClubEmoji(null);
      setClubLogoUrl(null);
    } else {
      // On another page (events, matches, etc.) — restore from session
      const savedName = sessionStorage.getItem("activeClubName");
      const savedEmoji = sessionStorage.getItem("activeClubEmoji");
      if (savedName) {
        setClubName(savedName);
        setClubEmoji(savedEmoji);
        setClubLogoUrl(sessionStorage.getItem("activeClubLogoUrl"));
      }
    }
  }, [urlClubId, isClubsListPage]);

  const activeClubId = urlClubId || (typeof window !== "undefined" ? sessionStorage.getItem("activeClubId") : null);

  // Determine if the user is an admin
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  // Build user summary for the avatar
  const userInitial = session?.user?.name?.[0]?.toUpperCase() ?? "?";

  const isHidden = isAuthPage || EVENT_DETAIL_RE.test(pathname);

  // Reset main padding when header is hidden — in useEffect to avoid hydration mismatch
  useEffect(() => {
    if (isHidden) {
      const main = document.getElementById("main-content");
      if (main) main.style.paddingTop = "0px";
      document.documentElement.style.setProperty("--header-height", "0");
    }
  }, [isHidden]);

  if (isHidden) {
    return null;
  }

  return (
    <>
      <div ref={headerRef as React.RefObject<HTMLDivElement>}>
        <AppHeader
          isAdmin={isAdmin}
          notifications={unreadCount}
          user={{
            initial: userInitial,
            href: "/profile",
          }}
        />
      </div>
      {showPasswordModal && (
        <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />
      )}
    </>
  );
}
