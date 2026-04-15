"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";

const APP_VERSION = "5.0.0";
const HIDDEN_PATHS = ["/signin", "/register", "/claim", "/reset"];

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
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNotifications) return;
    const handler = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNotifications]);
  const [clubName, setClubName] = useState<string | null>(null);
  const [clubEmoji, setClubEmoji] = useState<string | null>(null);
  const [clubLogoUrl, setClubLogoUrl] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Dynamically set main content padding based on header height
  const updateMainPadding = useCallback(() => {
    if (headerRef.current) {
      const h = headerRef.current.offsetHeight;
      const main = document.getElementById("main-content");
      if (main) main.style.paddingTop = `${h + 8}px`;
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

  return (
    <>
      <header ref={headerRef} className="fixed top-0 left-0 right-0 z-50 bg-black text-white px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-md">
        <div className="max-w-[600px] mx-auto">
          {/* Top row: app name + user */}
          <div className="flex items-center justify-between">
            <button onClick={() => router.push("/events")} className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer">
              <h1 className="text-lg font-bold tracking-tight">PickleJ</h1>
              <span className="text-[10px] opacity-60 font-mono">v{APP_VERSION}</span>
            </button>
            {!isAuthPage && session?.user && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => router.push("/profile")}
                  className="text-sm opacity-90 hover:opacity-100 transition-opacity"
                  title="My profile"
                  aria-label={`Profile for ${session.user.name}`}
                >
                  {session.user.name}
                </button>
                <div className="relative" ref={notifRef}>
                  <button
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="relative text-lg opacity-90 hover:opacity-100"
                    title="Notifications"
                    aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
                  >
                    🔔
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                  {showNotifications && (
                    <div className="absolute right-0 top-8 w-72 bg-white rounded-xl shadow-xl border border-border z-50 max-h-80 overflow-y-auto">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                        <span className="text-xs font-semibold text-foreground">Notifications</span>
                        {unreadCount > 0 && (
                          <button onClick={async () => {
                            await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read_all" }) });
                            setUnreadCount(0);
                            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                          }} className="text-[10px] text-action font-medium">Mark all read</button>
                        )}
                      </div>
                      {notifications.length === 0 ? (
                        <p className="text-xs text-muted text-center py-4">No notifications</p>
                      ) : (
                        notifications.slice(0, 20).map((n) => (
                          <button key={n.id} onClick={() => {
                            if (n.linkUrl) router.push(n.linkUrl);
                            setShowNotifications(false);
                            if (!n.read) {
                              fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", notificationId: n.id }) });
                              setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
                              setUnreadCount((c) => Math.max(0, c - 1));
                            }
                          }} className={`w-full text-left px-3 py-2 border-b border-border last:border-b-0 hover:bg-gray-50 ${!n.read ? "bg-blue-50" : ""}`}>
                            <div className="text-xs font-medium text-foreground">{n.title}</div>
                            {n.body && <div className="text-[10px] text-muted mt-0.5">{n.body}</div>}
                            <div className="text-[9px] text-muted mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/signin" })}
                  className="text-[10px] bg-white/15 px-2 py-0.5 rounded-md hover:bg-white/25 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>

          {/* Club context row + tab bar */}
        </div>
      </header>
      {showPasswordModal && (
        <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />
      )}
    </>
  );
}
