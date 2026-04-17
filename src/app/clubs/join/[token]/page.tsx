"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

interface ClubInfo {
  club: { id: string; name: string; emoji: string; _count: { members: number } };
  token: string;
}

export default function JoinClubPage() {
  const { token } = useParams();
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const [info, setInfo] = useState<ClubInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/clubs/join/${token}`)
      .then(async (r) => {
        if (r.ok) setInfo(await r.json());
        else setError((await r.json()).error || "Invalid invite link");
      })
      .catch(() => setError("Failed to load invite"))
      .finally(() => setLoading(false));
  }, [token]);

  const handleJoin = async () => {
    setJoining(true);
    const r = await fetch(`/api/clubs/join/${token}`, { method: "POST" });
    const data = await r.json();
    if (r.ok) {
      setJoined(true);
      setTimeout(() => router.push(`/clubs/${data.clubId}`), 1500);
    } else {
      setError(data.error || "Failed to join");
    }
    setJoining(false);
  };

  if (loading) {
    return (
      <div className="max-w-sm mx-auto py-12 space-y-6">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-bold">Join Club</h1>
        </div>
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20 space-y-4">
        <div className="text-5xl">😕</div>
        <p className="text-lg font-medium">{error}</p>
        <button onClick={() => router.push("/clubs")}
          className="text-sm text-action font-medium">Go to My Clubs</button>
      </div>
    );
  }

  if (!info) return null;

  const isLoggedIn = authStatus === "authenticated" && session?.user;

  return (
    <div className="max-w-sm mx-auto py-12 space-y-6">
      <div className="text-center space-y-3">
        <div className="text-6xl">{info.club.emoji}</div>
        <h1 className="text-2xl font-bold">{info.club.name}</h1>
        <p className="text-sm text-muted">{info.club._count.members} member{info.club._count.members !== 1 ? "s" : ""}</p>
      </div>

      <div className="bg-card rounded-xl border border-border p-6 text-center space-y-4">
        <p className="text-sm text-muted">You&apos;ve been invited to join this club</p>

        {joined ? (
          <div className="space-y-2">
            <div className="text-3xl">🎉</div>
            <p className="text-sm font-semibold text-green-600">Welcome! Redirecting...</p>
          </div>
        ) : !isLoggedIn ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">Sign in or create an account to join</p>
            <button onClick={() => router.push(`/signin?callbackUrl=/clubs/join/${token}`)}
              className="w-full bg-action text-white py-2.5 rounded-xl font-semibold active:bg-action-dark">
              Sign In to Join
            </button>
            <button onClick={() => router.push(`/register?callbackUrl=/clubs/join/${token}`)}
              className="w-full bg-gray-100 text-foreground py-2.5 rounded-xl font-medium hover:bg-gray-200">
              Create Account
            </button>
          </div>
        ) : (
          <button onClick={handleJoin} disabled={joining}
            className="w-full bg-action text-white py-2.5 rounded-xl font-semibold active:bg-action-dark disabled:opacity-50">
            {joining ? "Joining..." : "Join Club"}
          </button>
        )}
      </div>
    </div>
  );
}
