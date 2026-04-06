"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";

const APP_VERSION = "3.2.0";
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
  const [clubName, setClubName] = useState<string | null>(null);
  const [clubEmoji, setClubEmoji] = useState<string | null>(null);
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
            sessionStorage.setItem("activeClubName", data.name);
            sessionStorage.setItem("activeClubEmoji", data.emoji);
          }
        });
    } else if (isClubsListPage) {
      // Back at clubs list — clear context
      sessionStorage.removeItem("activeClubId");
      sessionStorage.removeItem("activeClubName");
      sessionStorage.removeItem("activeClubEmoji");
      setClubName(null);
      setClubEmoji(null);
    } else {
      // On another page (events, matches, etc.) — restore from session
      const savedName = sessionStorage.getItem("activeClubName");
      const savedEmoji = sessionStorage.getItem("activeClubEmoji");
      if (savedName) {
        setClubName(savedName);
        setClubEmoji(savedEmoji);
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
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight">PickleJ</h1>
              <span className="text-[10px] opacity-60 font-mono">v{APP_VERSION}</span>
            </div>
            {!isAuthPage && session?.user && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="text-sm opacity-90 hover:opacity-100 transition-opacity"
                  title="Change password"
                >
                  {session.user.name}
                </button>
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
          {activeClubId && clubName && (
            <>
              <div className="flex items-center gap-2 mt-1 pt-1 border-t border-white/10">
                <button
                  onClick={() => router.push("/clubs")}
                  className="text-white/70 hover:text-white text-sm font-medium"
                >
                  ←
                </button>
                <button
                  onClick={() => router.push(`/clubs/${activeClubId}`)}
                  className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                >
                  <span className="text-sm">{clubEmoji}</span>
                  <span className="text-sm font-semibold opacity-90">{clubName}</span>
                </button>
              </div>
              {/* Club tab bar — always visible when in club context */}
              <div className="mt-1.5 relative">
                <div id="club-tab-bar-portal" className="relative z-10" />
                {/* Fallback tabs when portal isn't filled (e.g., on event page) */}
                <div id="club-tab-bar-fallback" className="flex gap-1 bg-white/10 rounded-xl p-1">
                  {[
                    { key: "feed", label: "Feed" },
                    { key: "events", label: "Events" },
                    { key: "members", label: "Members" },
                    { key: "rankings", label: "Rankings" },
                  ].map((t) => {
                    const isActive = (t.key === "events" && pathname.startsWith("/events/"));
                    return (
                    <button
                      key={t.key}
                      onClick={() => router.push(`/clubs/${activeClubId}?tab=${t.key}`)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${isActive ? "bg-white text-black" : "text-white hover:opacity-80"}`}
                    >
                      {t.label}
                    </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </header>
      {showPasswordModal && (
        <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />
      )}
    </>
  );
}
