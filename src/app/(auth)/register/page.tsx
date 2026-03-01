"use client";

import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useState, useEffect } from "react";

const EMOJIS = ["🏓", "🎯", "⚡", "🔥", "🌟", "💪", "🦅", "🐉", "🎪", "🍕", "🌊", "🎸"];

export default function RegisterPage() {
  const { data: session, status } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emoji, setEmoji] = useState("🏓");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If already signed in, redirect to home
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      window.location.href = "/";
    }
  }, [status, session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password,
        emoji,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Registration failed");
      setLoading(false);
      return;
    }

    // Auto sign-in after registration
    const result = await signIn("credentials", {
      email: email.toLowerCase().trim(),
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Registered but failed to sign in. Try signing in manually.");
      setLoading(false);
      return;
    }

    // Full page reload to properly initialize session
    window.location.href = "/";
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-5xl mb-2">🏓</div>
        <h2 className="text-2xl font-bold">Create Account</h2>
        <p className="text-muted text-sm mt-1">Join PickleJ to start tracking your games</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-4 space-y-4">
        {error && (
          <div className="bg-red-50 text-danger text-sm px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-muted mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
            required
            minLength={6}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">Avatar</label>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={`text-2xl p-1 rounded-lg transition-all ${
                  emoji === e
                    ? "bg-primary/10 ring-2 ring-primary scale-110"
                    : "hover:bg-gray-100"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white py-3 rounded-lg font-semibold active:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>

      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/signin" className="text-primary font-medium">
          Sign In
        </Link>
      </p>
    </div>
  );
}
