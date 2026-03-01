"use client";

import { signIn, useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";

export default function ResetPasswordPage() {
  const params = useParams();
  const token = params.token as string;
  const { data: session, status: sessionStatus } = useSession();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [playerName, setPlayerName] = useState("");

  // If already signed in, redirect to home
  useEffect(() => {
    if (sessionStatus === "authenticated" && session?.user) {
      window.location.href = "/";
    }
  }, [sessionStatus, session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Something went wrong");
      setLoading(false);
      return;
    }

    setPlayerName(data.playerName);
    setSuccess(true);

    // Auto sign-in with new password
    const result = await signIn("credentials", {
      email: data.email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Password reset! Please sign in manually.");
      setLoading(false);
      return;
    }

    // Full page reload to properly initialize session
    window.location.href = "/";
  };

  if (success && !error) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-3">🔑</div>
        <h2 className="text-xl font-bold mb-2">
          Password reset, {playerName}!
        </h2>
        <p className="text-muted">Signing you in...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-5xl mb-2">🔑</div>
        <h2 className="text-2xl font-bold">Reset Password</h2>
        <p className="text-muted text-sm mt-1">Enter your new password</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-card rounded-xl border border-border p-4 space-y-4"
      >
        {error && (
          <div className="bg-red-50 text-danger text-sm px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            New Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
            autoFocus
            required
            minLength={6}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Confirm Password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Type it again"
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
            required
            minLength={6}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white py-3 rounded-lg font-semibold active:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {loading ? "Resetting..." : "Reset Password"}
        </button>
      </form>
    </div>
  );
}
