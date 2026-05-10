"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppHeader } from "@/components/AppHeader";
import { useHideBottomNav } from "@/lib/hooks";
import { frameClass } from "@/components/Card";

type Preference = "prefer" | "ok" | "no";

interface Category {
  id: string; name: string; format: string; gender: string;
}

// LeagueCategory.gender: "male" | "female" | "mix" | "open"
// Player.gender: "M" | "F" | null
function categoryMatchesGender(catGender: string, playerGender: string | null | undefined) {
  if (!playerGender) return true;
  if (catGender === "male") return playerGender === "M";
  if (catGender === "female") return playerGender === "F";
  return true;
}

export default function EventSignUpPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  // ?for=<playerId> → captain or organizer is signing up someone else (e.g.
  // a teammate without the app). Empty/missing = self-signup.
  const onBehalfOf = searchParams.get("for");
  const targetId = onBehalfOf || userId;
  const isOnBehalf = !!onBehalfOf && onBehalfOf !== userId;
  const [targetName, setTargetName] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState("");
  const [roundName, setRoundName] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [playerGender, setPlayerGender] = useState<string | null>(null);
  const [myTeamName, setMyTeamName] = useState<string | null>(null); // set if rostered on a playing team
  // Three intents (UI tri-state). Backend stores:
  //   playing      → status="registered", signupPreferences set
  //   attending    → status="registered", signupPreferences = {} (no league play)
  //   unavailable  → status="unavailable", signupPreferences kept for context
  const [intent, setIntent] = useState<"playing" | "attending" | "unavailable">("playing");
  const [preferences, setPreferences] = useState<Record<string, { level: Preference; note?: string }>>({});
  const [savedView, setSavedView] = useState(false);

  useHideBottomNav();

  const load = useCallback(async () => {
    const [evR, meR] = await Promise.all([
      fetch(`/api/events/${id}`),
      targetId ? fetch(`/api/players/${targetId}`) : Promise.resolve(null),
    ]);
    if (!evR.ok) { router.push(`/events/${id}`); return; }
    const ev = await evR.json();

    if (!ev.round) {
      // Not a league event — bounce back. Sign-up only applies to league events.
      router.push(`/events/${id}`);
      return;
    }

    setEventName(ev.name);
    setEventDate(ev.date ?? null);
    setLeagueName(ev.round.league.name);
    setRoundName(ev.round.name || `Round ${ev.round.roundNumber}`);
    setCategories((ev.round.league.categories || []) as Category[]);

    // Find which (if any) of the event's playing teams the target is on.
    // Sign-up is gated to rostered players on one of the playing teams.
    type LeagueTeamLite = { id: string; name: string; players: { playerId: string }[] };
    const allTeams: LeagueTeamLite[] = ev.round.league.teams || [];
    const playingTeamIds: string[] = (ev.leagueTeams || []).map((et: { teamId: string }) => et.teamId);
    const targetTeam = allTeams.find((t) => playingTeamIds.includes(t.id) && t.players.some((p) => p.playerId === targetId));
    setMyTeamName(targetTeam?.name ?? null);

    // Existing EventPlayer for the target — pre-fill intent + prefs.
    type EP = { player: { id: string }; status?: string; signupPreferences?: Record<string, { level: Preference; note?: string }> | null };
    const targetEp: EP | undefined = (ev.players || []).find((ep: EP) => ep.player.id === targetId);
    if (targetEp) {
      const prefs = targetEp.signupPreferences && typeof targetEp.signupPreferences === "object"
        ? targetEp.signupPreferences as Record<string, { level: Preference; note?: string }>
        : {};
      const hasAnyPlay = Object.values(prefs).some((p) => p.level === "prefer" || p.level === "ok");
      if (targetEp.status === "unavailable") setIntent("unavailable");
      else if (Object.keys(prefs).length === 0 || !hasAnyPlay) setIntent("attending");
      else setIntent("playing");
      setPreferences(prefs);
    }

    if (meR && meR.ok) {
      const me = await meR.json();
      setPlayerGender(me.gender || null);
      setTargetName(me.name || null);
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
    let payload: { status: "registered" | "unavailable"; preferences: Record<string, { level: Preference; note?: string }> };
    if (intent === "playing") {
      // Default any visible category the user didn't tap to "ok" so the
      // captain sees a complete picture.
      const visibleCategories = categories.filter((c) => categoryMatchesGender(c.gender, playerGender));
      const completePrefs: Record<string, { level: Preference; note?: string }> = {};
      for (const c of visibleCategories) {
        completePrefs[c.id] = preferences[c.id] ?? { level: "ok" };
      }
      payload = { status: "registered", preferences: completePrefs };
    } else if (intent === "attending") {
      // Attending only — no league play. Keep any prior notes by sending {}.
      payload = { status: "registered", preferences: {} };
    } else {
      payload = { status: "unavailable", preferences };
    }
    const r = await fetch(`/api/events/${id}/signup-prefs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isOnBehalf ? { ...payload, playerId: onBehalfOf } : payload),
    });
    setSaving(false);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErrorMsg(d.error || "Failed to sign up"); return; }
    if (isOnBehalf) {
      // Captain workflow — skip the celebratory card and drop them
      // straight back into the participants section. Use sessionStorage
      // to surface a small toast on the event page if/when we add one.
      router.push(`/events/${id}#participants`);
      return;
    }
    setSavedView(true);
  };

  if (savedView) {
    // On-behalf saves never reach this — they navigate back immediately.
    const intentLabel = intent === "playing"
      ? "You're signed up to this event"
      : intent === "attending"
        ? "You're coming but not playing league matches"
        : "Marked as not available";
    const intentBody = intent === "playing"
      ? <>The captain will pick the lineup from everyone signed up — your preferences guide the choice but don&apos;t guarantee a slot.</>
      : intent === "attending"
        ? <>The captain knows you&apos;re coming but not playing league matches this match-day.</>
        : <>The captain knows you can&apos;t make it.</>;
    return (
      <>
        <AppHeader variant="hero-sub" title="Sign-up" back={{ label: "Back to event", onClick: () => router.push(`/events/${id}`) }} />
        <div className="space-y-2">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm space-y-2">
            <p className="font-semibold text-emerald-900">
              ✓ {intentLabel}{myTeamName ? <> for <span className="font-bold">{myTeamName}</span></> : null}
            </p>
            <p className="text-emerald-800">{intentBody}</p>
            <button onClick={() => router.push(`/events/${id}`)} className="text-sm text-emerald-700 font-medium hover:underline">Done</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader
        variant="hero-sub"
        title={isOnBehalf ? `Sign up ${targetName || "player"}` : myTeamName ? `Sign up · ${myTeamName}` : "Sign up"}
        back={{ label: "Back to event", onClick: () => router.push(`/events/${id}`) }}
      />
    <div className="space-y-2">

      <div className={`${frameClass} p-4 space-y-2`}>
        <h2 className="text-lg font-bold">
          {isOnBehalf
            ? <>Sign up <span className="text-action">{targetName || "player"}</span></>
            : <>Sign up{myTeamName ? <> for <span className="text-action">{myTeamName}</span></> : ""}</>}
        </h2>
        <p className="text-[11px] text-muted">
          {leagueName} · {roundName}
          {eventDate && <> · {new Date(eventDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</>}
          {isOnBehalf && myTeamName && <> · {myTeamName}</>}
        </p>
        {isOnBehalf && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            You&apos;re signing up <strong>{targetName || "this player"}</strong> on their behalf.
          </p>
        )}
        {errorMsg && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{errorMsg}</div>
        )}

        {!loading && !myTeamName && (
          <p className="text-sm text-muted">Sign-up is for players on one of the two teams playing this match-day.</p>
        )}

        {myTeamName && (
          <div>
            <label className="block text-xs text-muted mb-1">What are you doing?</label>
            <div className="grid grid-cols-3 gap-1">
              <button onClick={() => setIntent("playing")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "playing" ? "bg-action text-white" : "bg-gray-100 text-muted"}`}
              >Playing</button>
              <button onClick={() => setIntent("attending")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "attending" ? "bg-emerald-500 text-white" : "bg-gray-100 text-muted"}`}
              >Just attending</button>
              <button onClick={() => setIntent("unavailable")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "unavailable" ? "bg-rose-500 text-white" : "bg-gray-100 text-muted"}`}
              >Can&apos;t come</button>
            </div>
            {intent === "attending" && (
              <p className="text-[11px] text-muted mt-2">You&apos;ll be counted as coming but not playing any league matches.</p>
            )}
          </div>
        )}
      </div>

      {myTeamName && intent === "playing" && (() => {
        const visibleCategories = categories.filter((c) => categoryMatchesGender(c.gender, playerGender));
        if (!loading && visibleCategories.length === 0) return null;
        return (
          <div className={`${frameClass} p-4 space-y-3`}>
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

      {myTeamName && (
        <div className={`${frameClass} p-3 sticky bottom-2`}>
          <button onClick={submit} disabled={saving || loading}
            className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save sign-up"}
          </button>
        </div>
      )}
    </div>
    </>
  );
}
