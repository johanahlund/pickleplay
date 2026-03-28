"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

const APP_VERSION = "1.2.0";
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
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:opacity-90 disabled:opacity-50"
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
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const isAuthPage = HIDDEN_PATHS.some((p) => pathname.startsWith(p));

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-primary text-white px-4 py-3 shadow-md">
        <div className="max-w-[600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">🏓 PickleJ</h1>
            <span className="text-xs opacity-80 font-mono">v{APP_VERSION}</span>
          </div>
          {!isAuthPage && session?.user && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPasswordModal(true)}
                className="text-sm opacity-90 hover:opacity-100 transition-opacity"
                title="Change password"
              >
                {session.user.emoji} {session.user.name}
              </button>
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
      {showPasswordModal && (
        <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />
      )}
    </>
  );
}
