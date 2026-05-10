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
  // Four intents (UI quad-state). Backend stores:
  //   playing      → status="registered", category prefs set
  //   social       → status="registered", _intent="social" sentinel in prefs
  //   attending    → status="registered", _intent="attending" sentinel in prefs
  //   unavailable  → status="unavailable", prefs kept for context
  const [intent, setIntent] = useState<"playing" | "social" | "attending" | "unavailable">("playing");
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
    type LeagueRosterPlayer = { playerId: string; participationPrefs?: Record<string, { level: Preference; note?: string }> | null };
    type LeagueTeamLite = { id: string; name: string; players: LeagueRosterPlayer[] };
    const allTeams: LeagueTeamLite[] = ev.round.league.teams || [];
    const playingTeamIds: string[] = (ev.leagueTeams || []).map((et: { teamId: string }) => et.teamId);
    const targetTeam = allTeams.find((t) => playingTeamIds.includes(t.id) && t.players.some((p) => p.playerId === targetId));
    setMyTeamName(targetTeam?.name ?? null);

    // Default category prefs from the player's league sign-up
    // (LeagueParticipationRequest.preferences). Used when no per-event
    // EventPlayer exists yet, so the form opens already personalised.
    const targetRosterEntry = targetTeam?.players.find((p) => p.playerId === targetId);
    const leaguePrefs = targetRosterEntry?.participationPrefs && typeof targetRosterEntry.participationPrefs === "object"
      ? targetRosterEntry.participationPrefs as Record<string, { level: Preference; note?: string }>
      : null;

    // Existing EventPlayer for the target — pre-fill intent + prefs.
    type EP = { player: { id: string }; status?: string; signupPreferences?: Record<string, { level: Preference; note?: string }> | null };
    const targetEp: EP | undefined = (ev.players || []).find((ep: EP) => ep.player.id === targetId);
    if (targetEp) {
      const rawPrefs = targetEp.signupPreferences && typeof targetEp.signupPreferences === "object"
        ? targetEp.signupPreferences as Record<string, { level: Preference; note?: string } | string>
        : {};
      // _intent is a reserved sentinel — strip before using prefs as
      // category map. Stored as a plain string for forward compat.
      const sentinel = typeof rawPrefs._intent === "string" ? rawPrefs._intent : null;
      const prefs: Record<string, { level: Preference; note?: string }> = {};
      for (const [k, v] of Object.entries(rawPrefs)) {
        if (k === "_intent") continue;
        if (v && typeof v === "object" && "level" in v) prefs[k] = v as { level: Preference; note?: string };
      }
      const hasAnyPlay = Object.values(prefs).some((p) => p.level === "prefer" || p.level === "ok");
      if (targetEp.status === "unavailable") setIntent("unavailable");
      else if (sentinel === "social") setIntent("social");
      else if (sentinel === "attending" || Object.keys(prefs).length === 0 || !hasAnyPlay) setIntent("attending");
      else setIntent("playing");
      setPreferences(prefs);
    } else if (leaguePrefs) {
      // First-time event sign-up: seed from league-level preferences and
      // assume "Liga play" intent. Captain/player can adjust freely.
      setIntent("playing");
      setPreferences(leaguePrefs);
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
    // Server stores `_intent` as a sentinel inside signupPreferences so
    // we can distinguish "social" from "attending" without a schema change.
    let payload: { status: "registered" | "unavailable"; preferences: Record<string, unknown> };
    if (intent === "playing") {
      // Default any visible category the user didn't tap to "ok" so the
      // captain sees a complete picture.
      const visibleCategories = categories.filter((c) => categoryMatchesGender(c.gender, playerGender));
      const completePrefs: Record<string, { level: Preference; note?: string }> = {};
      for (const c of visibleCategories) {
        completePrefs[c.id] = preferences[c.id] ?? { level: "ok" };
      }
      payload = { status: "registered", preferences: completePrefs };
    } else if (intent === "social") {
      // Coming to play casual matches but not the league lineup.
      payload = { status: "registered", preferences: { _intent: "social" } };
    } else if (intent === "attending") {
      payload = { status: "registered", preferences: { _intent: "attending" } };
    } else {
      payload = { status: "unavailable", preferences: { ...preferences } };
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
            <label className="block text-xs text-muted mb-1">{isOnBehalf ? "How will they participate?" : "How will you participate?"}</label>
            <div className="grid grid-cols-2 gap-1">
              <button onClick={() => setIntent("playing")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "playing" ? "bg-action text-white" : "bg-gray-100 text-muted"}`}
              >🏆 Liga play</button>
              <button onClick={() => setIntent("social")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "social" ? "bg-blue-500 text-white" : "bg-gray-100 text-muted"}`}
              >🎾 Social play</button>
              <button onClick={() => setIntent("attending")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "attending" ? "bg-emerald-500 text-white" : "bg-gray-100 text-muted"}`}
              >👋 Just attending</button>
              <button onClick={() => setIntent("unavailable")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "unavailable" ? "bg-rose-500 text-white" : "bg-gray-100 text-muted"}`}
              >Can&apos;t come</button>
            </div>
            {intent === "social" && (
              <p className="text-[11px] text-muted mt-2">Coming to play casual matches — not eligible for league lineup.</p>
            )}
            {intent === "attending" && (
              <p className="text-[11px] text-muted mt-2">{isOnBehalf ? "They'll be counted as coming but not playing matches." : "You'll be counted as coming but not playing matches."}</p>
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
