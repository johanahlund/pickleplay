"use client";

import { signIn, useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { frameClass } from "@/components/Card";
import { PlayerAvatar } from "@/components/PlayerAvatar";

type Preview = {
  name: string;
  emoji: string;
  photoUrl: string | null;
  clubs: { name: string; emoji: string }[];
};

export default function ClaimPage() {
  const params = useParams();
  const token = params.token as string;
  const { data: session, status: sessionStatus } = useSession();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (sessionStatus === "authenticated" && session?.user) {
      window.location.href = "/";
    }
  }, [sessionStatus, session]);

  // Fetch who this token belongs to so the page shows the player's
  // name + clubs — recipients should see at a glance that they're
  // claiming the right pre-existing player record.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/claim?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.ok) {
          setPreview(await r.json());
        } else {
          const data = await r.json().catch(() => ({}));
          setPreviewError(data.error || "Invalid or expired invite link");
        }
      })
      .catch(() => setPreviewError("Couldn't load this invite. Try again."));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        email: email.toLowerCase().trim(),
        password,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Something went wrong");
      setLoading(false);
      return;
    }

    setSuccess(true);

    const result = await signIn("credentials", {
      email: email.toLowerCase().trim(),
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Account created! Please sign in manually.");
      setLoading(false);
      return;
    }

    window.location.href = "/";
  };

  if (success && !error) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-3">🎉</div>
        <h2 className="text-xl font-bold mb-2">Welcome, {preview?.name ?? "player"}!</h2>
        <p className="text-muted">Signing you in...</p>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-5xl mb-2">🏓</div>
          <h2 className="text-2xl font-bold">FriendlyBall</h2>
          <p className="text-muted text-sm">The friendly pickleball app</p>
        </div>
        <div className={`${frameClass} p-4 text-center`}>
          <div className="text-3xl mb-2">⚠️</div>
          <p className="text-sm text-danger">{previewError}</p>
          <p className="text-xs text-muted mt-2">Ask the person who invited you for a fresh link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-5xl mb-2">🏓</div>
        <h2 className="text-2xl font-bold">FriendlyBall</h2>
        <p className="text-muted text-sm">The friendly pickleball app</p>
      </div>

      {preview && (
        <div className={`${frameClass} p-4 flex items-center gap-3`}>
          <PlayerAvatar name={preview.name} photoUrl={preview.photoUrl} size="md" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted">You've been added as</div>
            <div className="text-lg font-bold truncate">{preview.name}</div>
            {preview.clubs.length > 0 && (
              <div className="text-xs text-muted mt-0.5 truncate">
                in {preview.clubs.map((c) => `${c.emoji} ${c.name}`).join(" · ")}
              </div>
            )}
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`${frameClass} p-4 space-y-4`}
      >
        <div>
          <h3 className="text-base font-semibold">Sign up</h3>
          <p className="text-xs text-muted">
            Pick an email + password to take over this account. From now on
            you'll use these to sign in.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-danger text-sm px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Password
          </label>
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

        <button
          type="submit"
          disabled={loading || !preview}
          className="w-full bg-action-dark text-white py-3 rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </form>
    </div>
  );
}
