"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppHeader } from "@/components/AppHeader";
import { useHideBottomNav } from "@/lib/hooks";
import { frameClass } from "@/components/Card";
import { LoadingState } from "@/components/LoadingState";
import { leagueShortName } from "@/lib/leagueDisplay";

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
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  // ?for=<playerId> → captain/vice (or league organizer) is editing a
  // teammate's league preferences. Saves via PATCH instead of POST.
  const onBehalfOf = searchParams.get("for");
  const isOnBehalf = !!onBehalfOf && onBehalfOf !== userId;
  // Optional ?team=<teamId> remembers which team's roster we came from so
  // the back link returns to it expanded + with the edited player row
  // scrolled into view + briefly highlighted.
  const fromTeamId = searchParams.get("team");
  const backHref = fromTeamId
    ? `/leagues/${id}?tab=teams&expandTeam=${fromTeamId}&focus=${fromTeamId}${onBehalfOf ? `&focusPlayer=${onBehalfOf}` : ""}`
    : `/leagues/${id}`;
  const [targetName, setTargetName] = useState<string | null>(null);

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

  useHideBottomNav();

  const targetId = onBehalfOf || userId;
  const load = useCallback(async () => {
    const [leagueR, requestsR, meR] = await Promise.all([
      fetch(`/api/leagues/${id}`),
      fetch(`/api/leagues/${id}/participation-requests`),
      targetId ? fetch(`/api/players/${targetId}`) : Promise.resolve(null),
    ]);
    if (!leagueR.ok) { router.push(backHref); return; }
    const league = await leagueR.json();
    setLeagueName(leagueShortName(league));
    setLeagueStatus(league.status);
    setCategories((league.categories || []).filter((c: Category) => c.status !== "draft"));
    setTeams(league.teams || []);

    if (meR && meR.ok) {
      const me = await meR.json();
      setPlayerGender(me.gender || null);
      setTargetName(me.name || null);
    }

    if (requestsR.ok && targetId) {
      const reqs = await requestsR.json();
      const theirs = Array.isArray(reqs) ? reqs.find((r: { playerId: string; preferredTeamId: string | null; preferences: Record<string, { level: Preference; note?: string }> | null; status: string }) => r.playerId === targetId) : null;
      if (theirs && (theirs.status === "pending" || theirs.status === "accepted")) {
        setPreferredTeamId(theirs.preferredTeamId || "");
        if (theirs.preferences && typeof theirs.preferences === "object") {
          setPreferences(theirs.preferences);
        }
        setExistingRequestStatus(theirs.status);
      }
    }
    setLoading(false);
  }, [id, router, targetId]);

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
      method: isOnBehalf ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferredTeamId: preferredTeamId || null,
        preferences: completePrefs,
        ...(isOnBehalf ? { playerId: onBehalfOf } : {}),
      }),
    });
    setSaving(false);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErrorMsg(d.error || "Failed to sign up"); return; }
    if (isOnBehalf) {
      // Captain edited a teammate's prefs — back to league, no celebration card.
      router.push(backHref);
      return;
    }
    setExistingRequestStatus("pending");
  };

  if (existingRequestStatus === "pending") {
    const chosenTeam = teams.find((t) => t.id === preferredTeamId);
    return (
      <>
        <AppHeader variant="hero-sub" title="Sign-up" back={{ label: fromTeamId ? "Back to team" : "Back to league", onClick: () => router.push(backHref) }} />
        <div className="space-y-2">
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
            <button onClick={() => router.push(backHref)} className="text-sm text-emerald-700 font-medium hover:underline">Done</button>
          </div>
        </div>
      </>
    );
  }

  // Accept legacy "registration" alongside the new "open".
  // Captain editing a teammate's prefs is allowed regardless of league
  // status — registration-closed only blocks self sign-up.
  const registrationClosed = !isOnBehalf && !loading && leagueStatus !== "open" && leagueStatus !== "registration";

  return (
    <>
      <AppHeader variant="hero-sub" title={isOnBehalf ? `Edit prefs · ${targetName || "Player"}` : "Sign-up"} back={{ label: fromTeamId ? "Back to team" : "Back to league", onClick: () => router.push(backHref) }} />
    <div className="space-y-2">

      <div className={`${frameClass} p-4 space-y-3`}>
        <h2 className="text-lg font-bold">
          {isOnBehalf
            ? <>Edit league preferences · <span className="text-action">{targetName || "Player"}</span></>
            : <>Sign up{leagueName ? ` — ${leagueName}` : ""}</>}
        </h2>
        {isOnBehalf && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            You&apos;re editing <strong>{targetName || "this player"}</strong>&apos;s league preferences on their behalf.
          </p>
        )}
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
          <div className={`${frameClass} p-4 space-y-3`}>
            <h3 className="text-sm font-semibold">Category preferences</h3>
            {loading ? (
              <LoadingState label="Loading categories…" compact />
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
        <div className={`${frameClass} p-3 sticky bottom-2`}>
          <button onClick={submit} disabled={saving || loading}
            className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50">
            {saving ? "Signing up…" : "Sign up"}
          </button>
        </div>
      )}
    </div>
    </>
  );
}
