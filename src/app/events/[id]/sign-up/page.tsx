"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppHeader } from "@/components/AppHeader";
import { useHideBottomNav } from "@/lib/hooks";
import { frameClass } from "@/components/Card";
import { LoadingState } from "@/components/LoadingState";
import { leagueShortName } from "@/lib/leagueDisplay";
import { useConfirm } from "@/components/ConfirmDialog";

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
  const { confirm: confirmDialog, alert: alertDialog } = useConfirm();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  // ?for=<playerId> → captain or organizer is signing up someone else (e.g.
  // a teammate without the app). Empty/missing = self-signup.
  const onBehalfOf = searchParams.get("for");
  const targetId = onBehalfOf || userId;
  const isOnBehalf = !!onBehalfOf && onBehalfOf !== userId;
  // ?returnTo=<path> → after saving (in the on-behalf flow), navigate
  // back here. Used by the league lineup page so captains return to the
  // lineup picker instead of the public event page. Must be a relative
  // path beginning with "/" to avoid open redirects.
  const rawReturnTo = searchParams.get("returnTo");
  const returnTo = rawReturnTo && rawReturnTo.startsWith("/") ? rawReturnTo : null;
  // Sub-flow back: when launched from a team lineup (returnTo set) return there
  // labelled by destination; otherwise back to the event's Participants.
  const backHref = returnTo || `/events/${id}?section=players`;
  const backLabel = returnTo
    ? returnTo.includes("/lineup/")
      ? "Team"
      : returnTo.startsWith("/leagues")
        ? "League"
        : "Event"
    : "Participants";
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
  // Guest mode: target is NOT on a playing-team roster but is tagged to
  // one via signupPreferences._guestTeamId. They can only be social or
  // attending (never "playing" — they aren't in any lineup). guestTeamId
  // is preserved through save so the team-column membership doesn't get
  // dropped when prefs are rewritten.
  const [guestTeamId, setGuestTeamId] = useState<string | null>(null);
  const [guestTeamName, setGuestTeamName] = useState<string | null>(null);
  // Four intents (UI quad-state). Backend stores:
  //   playing      → status="registered", category prefs set
  //   social       → status="registered", _intent="social" sentinel in prefs
  //   attending    → status="registered", _intent="attending" sentinel in prefs
  //   unavailable  → status="unavailable", prefs kept for context
  const [intent, setIntent] = useState<"playing" | "social" | "attending" | "unavailable">("playing");
  const [preferences, setPreferences] = useState<Record<string, { level: Preference; note?: string }>>({});
  const [savedView, setSavedView] = useState(false);
  // Tracks whether the target already had an EventPlayer when the page
  // loaded — used to switch the success card from "Signed up" to "Updated"
  // AND to swap the page header between "Sign up" and "Edit preferences".
  // Initialised from `?edit=1` so the initial render (before the API fetch
  // lands) already shows the right title when arriving via the pen icon.
  const editHint = searchParams.get("edit") === "1";
  const [wasExistingSignup, setWasExistingSignup] = useState(editHint);

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
    setLeagueName(leagueShortName(ev.round.league));
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
    // Guest detection: the target may already have a guest-mode sign-up
    // recorded (signupPreferences._guestTeamId points at a playing team).
    // In that case the intent picker is unblocked even though the target
    // is not on the team roster.
    if (!targetTeam) {
      type EPLite = { player: { id: string }; signupPreferences?: Record<string, unknown> | null };
      const targetEpForGuest = (ev.players || []).find((ep: EPLite) => ep.player.id === targetId);
      const prefs = targetEpForGuest?.signupPreferences as Record<string, unknown> | null | undefined;
      const gtid = typeof prefs?._guestTeamId === "string" ? (prefs._guestTeamId as string) : null;
      if (gtid && playingTeamIds.includes(gtid)) {
        const guestTeam = allTeams.find((t) => t.id === gtid);
        setGuestTeamId(gtid);
        setGuestTeamName(guestTeam?.name ?? null);
      }
    }

    // Default category prefs from the player's league sign-up
    // (LeagueParticipationRequest.preferences). Used when no per-event
    // EventPlayer exists yet, so the form opens already personalised.
    const targetRosterEntry = targetTeam?.players.find((p) => p.playerId === targetId);
    const leaguePrefs = targetRosterEntry?.participationPrefs && typeof targetRosterEntry.participationPrefs === "object"
      ? targetRosterEntry.participationPrefs as Record<string, { level: Preference; note?: string }>
      : null;

    // Lineup auto-seed: if the target is already placed in any leagueGame
    // for this event, we'll default their intent to "playing" and pre-tick
    // the matching categories as "prefer" — but ONLY when they have no
    // existing per-event prefs yet. (See further down where we apply this.)
    type LeagueGameLite = { id: string; categoryId: string; gamePlayers: { playerId: string }[] };
    const leagueGames: LeagueGameLite[] = Array.isArray(ev.leagueGames) ? ev.leagueGames : [];
    const linedUpCategoryIds = new Set<string>();
    for (const g of leagueGames) {
      if (g.gamePlayers.some((gp) => gp.playerId === targetId)) {
        linedUpCategoryIds.add(g.categoryId);
      }
    }

    // Existing EventPlayer for the target — pre-fill intent + prefs.
    type EP = { player: { id: string }; status?: string; signupPreferences?: Record<string, { level: Preference; note?: string }> | null };
    const targetEp: EP | undefined = (ev.players || []).find((ep: EP) => ep.player.id === targetId);
    if (targetEp) {
      setWasExistingSignup(true);
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
      // Lineup auto-seed for EXISTING sign-ups with no per-event prefs
      // recorded yet: if the captain placed them in a category lineup,
      // treat that as implicit consent — intent = "playing" and the
      // matched categories default to "prefer". Doesn't touch existing
      // prefs (we only fill an empty record).
      const isEmpty = Object.keys(prefs).length === 0 && !sentinel;
      if (isEmpty && linedUpCategoryIds.size > 0 && targetEp.status !== "unavailable") {
        for (const cid of linedUpCategoryIds) {
          prefs[cid] = { level: "prefer" };
        }
        setIntent("playing");
      } else if (targetEp.status === "unavailable") setIntent("unavailable");
      else if (sentinel === "social") setIntent("social");
      else if (sentinel === "attending" || Object.keys(prefs).length === 0 || !hasAnyPlay) setIntent("attending");
      else setIntent("playing");
      setPreferences(prefs);
    } else if (linedUpCategoryIds.size > 0) {
      // First-time view BUT the captain has already placed them in a
      // lineup → start from "playing" + the matched categories.
      setIntent("playing");
      const seeded: Record<string, { level: Preference; note?: string }> = leaguePrefs ? { ...leaguePrefs } : {};
      for (const cid of linedUpCategoryIds) {
        seeded[cid] = { level: "prefer" };
      }
      setPreferences(seeded);
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
    // Guest path: target isn't on a playing team's roster — route through
    // the signup-prefs "guest add" shape so _guestTeamId is preserved.
    // Guests can only be social or attending; "playing" is hidden in the
    // picker for guests so this branch only sees those two (or unavailable
    // → fall through to the rostered branch which sets status).
    if (guestTeamId && (intent === "social" || intent === "attending")) {
      const r = await fetch(`/api/events/${id}/signup-prefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerIds: [onBehalfOf || userId], intent, teamId: guestTeamId }),
      });
      setSaving(false);
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErrorMsg(d.error || "Failed to save"); return; }
      if (isOnBehalf) {
        router.push(returnTo || `/events/${id}?section=players`);
        return;
      }
      setSavedView(true);
      return;
    }
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
      // Captain workflow — skip the celebratory card. If a returnTo
      // path was provided (e.g., the league lineup page), go back there
      // so the captain stays in flow. Otherwise drop into the event
      // participants section.
      router.push(returnTo || `/events/${id}?section=players`);
      return;
    }
    setSavedView(true);
  };

  const removeFromEvent = async () => {
    const removeTargetId = onBehalfOf || userId;
    if (!removeTargetId) return;
    const who = isOnBehalf ? (targetName || "this player") : "you";
    const ok = await confirmDialog({
      title: isOnBehalf ? `Remove ${who} from event?` : "Leave this event?",
      message: isOnBehalf
        ? `${who}'s sign-up will be cancelled. They can sign up again later if their plans change.`
        : "Your sign-up will be cancelled. You can sign up again later.",
      confirmText: "Remove",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    const r = await fetch(`/api/events/${id}/players/${removeTargetId}`, { method: "DELETE" });
    setSaving(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      await alertDialog(d.error || "Failed to remove", "Error");
      return;
    }
    router.push(`/events/${id}`);
  };

  if (savedView) {
    // On-behalf saves never reach this — they navigate back immediately.
    const intentLabel = wasExistingSignup
      ? (intent === "playing"
          ? "Sign-up updated"
          : intent === "attending"
            ? "Updated — coming but not playing league matches"
            : "Updated — marked as not available")
      : (intent === "playing"
          ? "You're signed up to this event"
          : intent === "attending"
            ? "You're coming but not playing league matches"
            : "Marked as not available");
    const intentBody = wasExistingSignup
      ? <>Your preferences have been saved.</>
      : intent === "playing"
        ? <>The captain will pick the lineup from everyone signed up — your preferences guide the choice but don&apos;t guarantee a slot.</>
        : intent === "attending"
          ? <>The captain knows you&apos;re coming but not playing league matches this match-day.</>
          : <>The captain knows you can&apos;t make it.</>;
    return (
      <>
        <AppHeader variant="hero-sub" title="Sign-up" back={{ label: backLabel, onClick: () => router.push(backHref) }} />
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
        title={
          wasExistingSignup
            ? isOnBehalf
              ? `Edit preferences for ${targetName || "player"}`
              : myTeamName
                ? `Edit preferences · ${myTeamName}`
                : "Edit preferences"
            : isOnBehalf
              ? `Sign up ${targetName || "player"}`
              : myTeamName
                ? `Sign up · ${myTeamName}`
                : "Sign up"
        }
        back={{ label: backLabel, onClick: () => router.push(backHref) }}
      />
    <div className="space-y-2">

      {/* Header card — always visible so the user knows whose
          preferences they're about to edit while the form below
          loads. */}
      <div className={`${frameClass} p-4 space-y-2`}>
        <h2 className="text-lg font-bold">
          {wasExistingSignup ? (
            isOnBehalf
              ? <>Edit preferences for <span className="text-action">{targetName || "player"}</span></>
              : <>Edit preferences{myTeamName ? <> for <span className="text-action">{myTeamName}</span></> : ""}</>
          ) : (
            isOnBehalf
              ? <>Sign up <span className="text-action">{targetName || "player"}</span></>
              : <>Sign up{myTeamName ? <> for <span className="text-action">{myTeamName}</span></> : ""}</>
          )}
        </h2>
        <p className="text-[11px] text-muted">
          {leagueName} · {roundName}
          {eventDate && <> · {new Date(eventDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</>}
          {isOnBehalf && myTeamName && <> · {myTeamName}</>}
        </p>
        {isOnBehalf && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            {wasExistingSignup ? (
              <>You&apos;re editing preferences for <strong>{targetName || "this player"}</strong> on their behalf.</>
            ) : (
              <>You&apos;re signing up <strong>{targetName || "this player"}</strong> on their behalf.</>
            )}
          </p>
        )}
        {errorMsg && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{errorMsg}</div>
        )}
      </div>

      {/* Loading shim — shown BELOW the header card while the API
          fetch resolves, so the user has context (whose prefs they're
          editing) immediately and sees the spinner here as it loads. */}
      {loading && (
        <div className={`${frameClass} p-2`}>
          <LoadingState label="Loading preferences…" compact />
        </div>
      )}

      {!loading && (
      <div className={`${frameClass} p-4 space-y-2`}>
        {!myTeamName && !guestTeamId && (
          <p className="text-sm text-muted">Sign-up is for players on one of the two teams playing this match-day.</p>
        )}

        {(myTeamName || guestTeamId) && (
          <div>
            <label className="block text-xs text-muted mb-1">
              {guestTeamId
                ? <>Guest of <span className="font-semibold">{guestTeamName || "team"}</span> — choose intent</>
                : isOnBehalf ? "How will they participate?" : "How will you participate?"}
            </label>
            <div className={guestTeamId ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-1"}>
              {!guestTeamId && (
                <button onClick={() => setIntent("playing")}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "playing" ? "bg-action text-white" : "bg-gray-100 text-muted"}`}
                >🏆 Liga play</button>
              )}
              <button onClick={() => setIntent("social")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "social" ? "bg-blue-500 text-white" : "bg-gray-100 text-muted"}`}
              >🎾 Social play</button>
              <button onClick={() => setIntent("attending")}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "attending" ? "bg-emerald-500 text-white" : "bg-gray-100 text-muted"}`}
              >👋 Just attending</button>
              {!guestTeamId && (
                <button onClick={() => setIntent("unavailable")}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium ${intent === "unavailable" ? "bg-rose-500 text-white" : "bg-gray-100 text-muted"}`}
                >Can&apos;t come</button>
              )}
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
      )}

      {!loading && myTeamName && intent === "playing" && (() => {
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

      {myTeamName && (
        <div className={`${frameClass} p-3 sticky bottom-2 space-y-2`}>
          <button onClick={submit} disabled={saving || loading}
            className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save sign-up"}
          </button>
          {wasExistingSignup && (
            <button
              type="button"
              onClick={removeFromEvent}
              disabled={saving || loading}
              className="w-full text-danger text-xs font-medium py-2 rounded-xl border border-red-200 hover:bg-red-50 disabled:opacity-50"
            >
              {isOnBehalf ? `Remove ${targetName || "this player"} from event` : "Leave this event"}
            </button>
          )}
        </div>
      )}
    </div>
    </>
  );
}
