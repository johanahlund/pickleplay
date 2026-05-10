"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Preference = "prefer" | "ok" | "no";

interface Category {
  id: string; name: string; format: string; gender: string; ageGroup: string;
  skillMin: number | null; skillMax: number | null; status: string;
}
interface Team { id: string; name: string }

// LeagueCategory.gender: "male" | "female" | "mix" | "open"
// Player.gender: "M" | "F" | null
function categoryMatchesGender(catGender: string, playerGender: string | null | undefined) {
  if (!playerGender) return true; // unknown — don't hide
  if (catGender === "male") return playerGender === "M";
  if (catGender === "female") return playerGender === "F";
  return true; // "mix" and "open" match anyone
}

export default function LeagueSignUpPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState("");
  const [leagueStatus, setLeagueStatus] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [preferredTeamId, setPreferredTeamId] = useState<string>("");
  const [playerGender, setPlayerGender] = useState<string | null>(null);
  // preferences: { [categoryId]: { level, note? } }
  const [preferences, setPreferences] = useState<Record<string, { level: Preference; note?: string }>>({});
  const [existingRequestStatus, setExistingRequestStatus] = useState<string | null>(null);

  // Hide bottom nav while in this edit-style flow
  useEffect(() => {
    const nav = document.querySelector("nav.fixed.bottom-0");
    nav?.classList.add("hidden");
    return () => { nav?.classList.remove("hidden"); };
  }, []);

  const load = useCallback(async () => {
    const [leagueR, requestsR, meR] = await Promise.all([
      fetch(`/api/leagues/${id}`),
      fetch(`/api/leagues/${id}/participation-requests`),
      userId ? fetch(`/api/players/${userId}`) : Promise.resolve(null),
    ]);
    if (!leagueR.ok) { router.push(`/leagues/${id}`); return; }
    const league = await leagueR.json();
    setLeagueName(league.name);
    setLeagueStatus(league.status);
    setCategories((league.categories || []).filter((c: Category) => c.status !== "draft"));
    setTeams(league.teams || []);

    if (meR && meR.ok) {
      const me = await meR.json();
      setPlayerGender(me.gender || null);
    }

    if (requestsR.ok && userId) {
      const reqs = await requestsR.json();
      const mine = Array.isArray(reqs) ? reqs.find((r: { playerId: string; preferredTeamId: string | null; preferences: Record<string, { level: Preference; note?: string }> | null; status: string }) => r.playerId === userId) : null;
      if (mine && (mine.status === "pending" || mine.status === "accepted")) {
        setPreferredTeamId(mine.preferredTeamId || "");
        if (mine.preferences && typeof mine.preferences === "object") {
          setPreferences(mine.preferences);
        }
      }
    }
    setLoading(false);
  }, [id, router, userId]);

  useEffect(() => { load(); }, [load]);

  const setPref = (catId: string, level: Preference) => {
    setPreferences((prev) => {
      const next = { ...prev };
      const existing = next[catId] || { level: "ok" as Preference };
      next[catId] = { ...existing, level };
      return next;
    });
  };
  const setPrefNote = (catId: string, note: string) => {
    setPreferences((prev) => {
      const next = { ...prev };
      const existing = next[catId];
      if (!existing) {
        next[catId] = { level: "ok", note: note || undefined };
      } else {
        next[catId] = { ...existing, note: note || undefined };
      }
      return next;
    });
  };

  const submit = async () => {
    setSaving(true);
    setErrorMsg(null);
    // Default any visible category the user didn't explicitly tap to "ok" so
    // the captain sees a complete picture (otherwise unset categories look
    // missing on the request card).
    const visibleCategories = categories.filter((c) => categoryMatchesGender(c.gender, playerGender));
    const completePrefs: Record<string, { level: Preference; note?: string }> = {};
    for (const c of visibleCategories) {
      const existing = preferences[c.id];
      completePrefs[c.id] = existing ?? { level: "ok" };
    }
    const r = await fetch(`/api/leagues/${id}/participation-requests`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferredTeamId: preferredTeamId || null,
        preferences: completePrefs,
      }),
    });
    setSaving(false);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErrorMsg(d.error || "Failed to sign up"); return; }
    setExistingRequestStatus("pending");
  };

  if (existingRequestStatus === "pending") {
    const chosenTeam = teams.find((t) => t.id === preferredTeamId);
    return (
      <div className="space-y-2">
        <div className="sticky top-0 z-30 bg-background -mx-4 px-4 py-2 shadow-sm">
          <button onClick={() => router.push(`/leagues/${id}`)} className="text-sm text-action font-medium">← Back to league</button>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm space-y-2">
          <p className="font-semibold text-emerald-900">
            {chosenTeam
              ? <>✓ You&apos;re signed up for team <span className="font-bold">{chosenTeam.name}</span></>
              : <>✓ You&apos;re signed up as a free agent</>}
          </p>
          <p className="text-emerald-800">
            {chosenTeam
              ? <>Waiting for the team captain (or league director) to confirm.</>
              : <>Waiting for any team captain (or the league director) to pick you up.</>}
          </p>
          <button onClick={() => router.push(`/leagues/${id}`)} className="text-sm text-emerald-700 font-medium hover:underline">Done</button>
        </div>
      </div>
    );
  }

  // Accept legacy "registration" alongside the new "open".
  const registrationClosed = !loading && leagueStatus !== "open" && leagueStatus !== "registration";

  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-30 bg-background -mx-4 px-4 py-2 shadow-sm">
        <button onClick={() => router.push(`/leagues/${id}`)} className="text-sm text-action font-medium">← Back</button>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h2 className="text-lg font-bold">Sign up{leagueName ? ` — ${leagueName}` : ""}</h2>
        {errorMsg && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{errorMsg}</div>
        )}

        {registrationClosed ? (
          <div className="text-sm text-muted">Registration is not open for this league.</div>
        ) : (
          <div>
            <label className="block text-xs text-muted mb-1">Preferred team</label>
            <select value={preferredTeamId} onChange={(e) => setPreferredTeamId(e.target.value)}
              disabled={loading}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60">
              <option value="">{loading ? "Loading teams…" : "No preference (any team)"}</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {!registrationClosed && (() => {
        const visibleCategories = categories.filter((c) => categoryMatchesGender(c.gender, playerGender));
        if (!loading && visibleCategories.length === 0) return null;
        return (
          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold">Category preferences</h3>
            {loading ? (
              <div className="text-xs text-muted py-2">Loading categories…</div>
            ) : visibleCategories.map((cat) => {
              const pref = preferences[cat.id]?.level || "ok";
              const note = preferences[cat.id]?.note || "";
              return (
                <div key={cat.id} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="text-sm font-medium">{cat.name}</div>
                  <div className="flex gap-1">
                    {(["prefer", "ok", "no"] as const).map((lvl) => (
                      <button key={lvl} onClick={() => setPref(cat.id, lvl)}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${
                          pref === lvl ? "bg-black text-white" :
                          "bg-gray-100 text-muted"
                        }`}
                      >{lvl === "prefer" ? "Prefer" : lvl === "ok" ? "YES" : "NO"}</button>
                    ))}
                  </div>
                  <input type="text" value={note} onChange={(e) => setPrefNote(cat.id, e.target.value)}
                    placeholder="Note (optional)"
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" />
                </div>
              );
            })}
          </div>
        );
      })()}

      {!registrationClosed && (
        <div className="bg-card rounded-xl border border-border p-3 sticky bottom-2">
          <button onClick={submit} disabled={saving || loading}
            className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50">
            {saving ? "Signing up…" : "Sign up"}
          </button>
        </div>
      )}
    </div>
  );
}
