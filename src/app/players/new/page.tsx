"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useHideBottomNav } from "@/lib/hooks";
import { frameClass } from "@/components/Card";

interface MyClub {
  id: string;
  name: string;
  emoji: string;
  myRole: string;
}

interface ContextInfo {
  label: string; // e.g. "Setúbal • Lisbon Liga"
  clubId: string | null; // pre-select club when known
}

export default function NewPlayerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { alert } = useConfirm();

  useHideBottomNav();

  // Query-param context — when present the API authorises via the
  // league/team/event scope, so the user doesn't need to be a club admin.
  const leagueId = searchParams.get("leagueId");
  const teamId = searchParams.get("teamId");
  const eventId = searchParams.get("eventId");
  const returnTo = searchParams.get("returnTo") || "/players";
  const hasContext = !!(leagueId || teamId || eventId);

  const [name, setName] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [clubId, setClubId] = useState<string>("");
  const [clubs, setClubs] = useState<MyClub[]>([]);
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  useEffect(() => {
    fetch("/api/clubs")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: MyClub[]) => {
        const ownable = data.filter((c) => c.myRole === "owner" || c.myRole === "admin");
        setClubs(ownable);
        if (ownable.length === 1 && !isAdmin && !hasContext) setClubId(ownable[0].id);
      });
  }, [isAdmin, hasContext]);

  // Resolve a friendly label for the context banner and a default clubId
  // from the parent league/event/team.
  useEffect(() => {
    if (!hasContext) return;
    (async () => {
      let label = "";
      let defaultClubId: string | null = null;
      if (teamId && leagueId) {
        const r = await fetch(`/api/leagues/${leagueId}`).then((r) => r.ok ? r.json() : null);
        if (r) {
          const team = (r.teams ?? []).find((t: { id: string }) => t.id === teamId);
          label = team ? `${team.name} • ${r.shortName || r.name}` : (r.shortName || r.name);
          defaultClubId = r.club?.id ?? r.clubId ?? null;
        }
      } else if (leagueId) {
        const r = await fetch(`/api/leagues/${leagueId}`).then((r) => r.ok ? r.json() : null);
        if (r) {
          label = r.shortName || r.name;
          defaultClubId = r.club?.id ?? r.clubId ?? null;
        }
      } else if (eventId) {
        const r = await fetch(`/api/events/${eventId}`).then((r) => r.ok ? r.json() : null);
        if (r) {
          label = r.name || "this event";
          defaultClubId = r.clubId ?? null;
        }
      }
      setContextInfo({ label, clubId: defaultClubId });
      if (defaultClubId) setClubId(defaultClubId);
    })();
  }, [hasContext, leagueId, teamId, eventId]);

  const handleSave = async () => {
    if (!name.trim()) {
      await alert("Name is required", "Missing name");
      return;
    }
    // Non-admin without context must attach to a club they own/admin.
    // With context (leagueId/teamId/eventId), the API authorises via that
    // path so a club is not required.
    if (!isAdmin && !hasContext && !clubId) {
      await alert("Please select a club", "Club required");
      return;
    }
    setSaving(true);
    const r = await fetch("/api/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        ...(gender ? { gender } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(clubId ? { clubId } : {}),
        ...(leagueId ? { leagueId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(eventId ? { eventId } : {}),
      }),
    });
    if (r.ok) {
      // The returnTo URL may contain placeholder sentinels for the
      // freshly-created player's id (`__NEW__`) and/or display name
      // (`__NEW_NAME__`) — used by callers that want to surface a
      // toast or auto-stage the new player. URL-encode the name so it
      // round-trips safely through the query string.
      const created = await r.json().catch(() => null) as { id?: string; name?: string } | null;
      let finalReturn = returnTo;
      if (created?.id) finalReturn = finalReturn.replace("__NEW__", created.id);
      if (created?.name) finalReturn = finalReturn.replace("__NEW_NAME__", encodeURIComponent(created.name));
      router.push(finalReturn);
    } else {
      setSaving(false);
      const d = await r.json().catch(() => ({}));
      await alert(d.error || "Failed to add player", "Error");
    }
  };

  const canAdd = name.trim().length > 0 && (isAdmin || hasContext || !!clubId);

  return (
    <div className="space-y-4">
      <Link href={returnTo} className="text-sm text-action">&larr; Back</Link>

      <h2 className="text-xl font-bold">Add Player</h2>

      {hasContext && contextInfo && (
        <div className="rounded-lg bg-action/10 border border-action/30 px-3 py-2 text-sm">
          Adding a new player to <strong>{contextInfo.label}</strong>.
        </div>
      )}

      <div className={`${frameClass} p-4 space-y-3`}>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Player name"
            autoFocus
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">Gender (optional)</label>
          <div className="flex gap-2">
            {[
              { value: null, label: "Skip" },
              { value: "M", label: "♂ Male" },
              { value: "F", label: "♀ Female" },
            ].map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => setGender(g.value)}
                className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                  gender === g.value ? "bg-black text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">WhatsApp (optional)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+CC 123 456 789"
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Club {isAdmin || hasContext ? "(optional)" : ""}
          </label>
          <select
            value={clubId}
            onChange={(e) => setClubId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">{isAdmin || hasContext ? "No club" : "Select club..."}</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {!isAdmin && !hasContext && clubs.length === 0 && (
            <p className="text-xs text-muted mt-1">
              You need to be owner or admin of at least one club to add players.
            </p>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !canAdd}
          className="w-full bg-action text-white py-2.5 rounded-lg font-semibold active:bg-action-dark transition-colors disabled:opacity-50"
        >
          {saving ? "Adding..." : "Add Player"}
        </button>
      </div>
    </div>
  );
}
