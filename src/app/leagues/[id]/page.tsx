"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { useConfirm } from "@/components/ConfirmDialog";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import Link from "next/link";
import { autoCatName as buildCatName } from "@/lib/leagueCategories";
import { getPreview, setPreview } from "@/lib/entityPreview";

interface LeaguePreview {
  id: string;
  name: string;
  description: string | null;
  season: string | null;
  status: string;
  club?: { id: string; name: string; emoji: string; logoUrl?: string | null } | null;
}

interface Player { id: string; name: string; email?: string | null; photoUrl?: string | null; rating: number; gender?: string | null }
interface LeagueTeam {
  id: string; name: string; slogan?: string | null;
  logoUrl: string | null; photoUrl?: string | null;
  clubId?: string | null;
  club?: { id: string; name: string; emoji: string; logoUrl?: string | null } | null;
  captain?: { id: string; name: string; email?: string | null; photoUrl?: string | null } | null;
  viceCaptain?: { id: string; name: string; email?: string | null; photoUrl?: string | null } | null;
  players: { id: string; playerId: string; player: Player }[];
  _count: { players: number };
}
interface LeagueCategory { id: string; name: string; format: string; gender: string; ageGroup: string; skillMin: number | null; skillMax: number | null; scoringFormat: string; winBy: string; status: string; sortOrder: number; maxPerEvent: number | null }
interface LeagueGame {
  id: string; categoryId: string;
  isPrincipal: boolean;
  category: { id: string; name: string };
  team1: { id: string; name: string };
  team2: { id: string; name: string };
  winner?: { id: string; name: string } | null;
  matchId?: string | null;
}
interface LeagueLineupStatus { id: string; teamId: string; status: "draft" | "submitted" | "revealed"; unlockRequestedById: string | null }
// A league-attached event = a match-day for a round. Two teams play under it.
interface LeagueRoundEvent {
  id: string; name: string; date: string; status: string; hostTeamId: string | null;
  leagueTeams: { teamId: string; points: number; team: { id: string; name: string; logoUrl: string | null } }[];
  leagueGames: LeagueGame[];
  leagueLineups?: LeagueLineupStatus[];
}
interface LeagueRound {
  id: string; roundNumber: number; name: string | null;
  startDate: string | null; endDate: string | null;
  configOverride: Record<string, unknown> | null;
  categoriesOverride: unknown[] | null;
  status: string;
  events: LeagueRoundEvent[];
}
interface LeagueHelperEntry { id: string; playerId: string; player: { id: string; name: string; email?: string | null; photoUrl?: string | null } }
interface League {
  id: string; name: string; description: string | null; season: string | null; status: string;
  visibility?: "public" | "participants";
  clubId?: string | null;
  club?: { id: string; name: string; emoji: string; logoUrl?: string | null } | null;
  config: { maxRoster?: number; maxPointsPerMatchDay?: number; minMatchDaysForPlayoff?: number; maxMatchesPerEvent?: number; allowCrossCategoryPlay?: boolean } | null;
  rulesPdfUrl?: string | null;
  rulesPdfName?: string | null;
  documents?: { id: string; url: string; name: string; mimeType: string; sizeBytes: number }[];
  participationRequests?: { id: string; playerId: string; preferredTeamId: string | null; status: string; preferences?: Record<string, { level: "prefer" | "ok" | "no"; note?: string }> | null; player: { id: string; gender: string | null } }[];
  createdBy?: { id: string; name: string } | null;
  deputy?: { id: string; name: string } | null;
  helpers: LeagueHelperEntry[];
  teams: LeagueTeam[]; rounds: LeagueRound[]; categories: LeagueCategory[];
}
interface Standing { teamId: string; teamName: string; logoUrl: string | null; played: number; won: number; lost: number; drawn: number; points: number; totalCategoryWins: number; h2h: Record<string, number>; pointDifference: number }

type Tab = "overview" | "standings" | "rounds" | "matches" | "teams";

interface TeamRosterProps {
  team: LeagueTeam;
  canEdit: boolean;
  removingPlayerId: string | null;
  onRemove: (playerId: string, playerName: string) => void;
}

function TeamRoster({ team, canEdit, removingPlayerId, onRemove }: TeamRosterProps) {
  const [genderFilter, setGenderFilter] = useState<"all" | "F" | "M">("all");
  const [nameQuery, setNameQuery] = useState("");

  const sorted = [...team.players].sort((a, b) => {
    const rank = (id: string) => id === team.captain?.id ? 0 : id === team.viceCaptain?.id ? 1 : 2;
    const ra = rank(a.playerId);
    const rb = rank(b.playerId);
    return ra !== rb ? ra - rb : a.player.name.localeCompare(b.player.name);
  });

  const q = nameQuery.trim().toLowerCase();
  const filtered = sorted.filter((tp) => {
    if (genderFilter !== "all" && tp.player.gender !== genderFilter) return false;
    if (q && !tp.player.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const fCount = team.players.filter((tp) => tp.player.gender === "F").length;
  const mCount = team.players.filter((tp) => tp.player.gender === "M").length;
  const showFilters = team.players.length > 0;

  return (
    <div className="px-3 py-2 space-y-1">
      {showFilters && (
        <div className="flex items-center gap-1.5 pb-1">
          <button
            onClick={() => setGenderFilter("all")}
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${genderFilter === "all" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}
          >All</button>
          {fCount > 0 && (
            <button
              onClick={() => setGenderFilter((g) => (g === "F" ? "all" : "F"))}
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${genderFilter === "F" ? "bg-pink-500 text-white" : "bg-gray-100 text-pink-500"}`}
            >♀ {fCount}</button>
          )}
          {mCount > 0 && (
            <button
              onClick={() => setGenderFilter((g) => (g === "M" ? "all" : "M"))}
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${genderFilter === "M" ? "bg-blue-500 text-white" : "bg-gray-100 text-blue-500"}`}
            >♂ {mCount}</button>
          )}
          <input
            type="text"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Filter by name…"
            className="flex-1 min-w-0 text-xs border border-border rounded-full px-2.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      )}
      {filtered.length === 0 && team.players.length > 0 && (
        <div className="text-[11px] text-muted px-1 py-1">No players match the filter.</div>
      )}
      {filtered.map((tp) => {
        const isLeader = team.captain?.id === tp.playerId;
        const isDeputy = team.viceCaptain?.id === tp.playerId;
        const removing = removingPlayerId === tp.playerId;
        return (
          <div key={tp.id} className={`flex items-center gap-2 py-1 transition-opacity ${removing ? "opacity-50 line-through" : ""}`}>
            <PlayerAvatar name={tp.player.name} photoUrl={tp.player.photoUrl} size="xs" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {tp.player.name}
                {isLeader && <span className="text-[10px] text-muted ml-1">(Leader)</span>}
                {isDeputy && <span className="text-[10px] text-muted ml-1">(Deputy)</span>}
              </div>
            </div>
            {tp.player.gender && (
              <span className={`text-xs ${tp.player.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>
                {tp.player.gender === "F" ? "♀" : "♂"}
              </span>
            )}
            <span className="text-xs text-muted">{tp.player.rating.toFixed(0)}</span>
            {canEdit && (
              removing ? (
                <span className="w-3.5 h-3.5 border-2 border-danger border-t-transparent rounded-full animate-spin" />
              ) : (
                <button
                  onClick={() => onRemove(tp.playerId, tp.player.name)}
                  className="text-xs text-danger px-1 hover:underline"
                  aria-label={`Remove ${tp.player.name}`}
                >✕</button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddRoundEventForm({
  teams, defaultDate, onAdd,
}: {
  teams: { id: string; name: string }[];
  defaultDate: string | null;
  onAdd: (team1Id: string, team2Id: string, hostTeamId: string, date: string | null) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [host, setHost] = useState("");
  const [date, setDate] = useState("");

  const reset = () => { setT1(""); setT2(""); setHost(""); setDate(""); };
  const close = () => { reset(); setOpen(false); };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full px-3 py-2 text-xs font-medium text-primary border-t border-border hover:bg-primary/5"
      >+ Add event</button>
    );
  }
  return (
    <div className="px-3 py-3 border-t border-border bg-gray-50 space-y-2">
      <div className="flex gap-2">
        <select value={t1} onChange={(e) => { setT1(e.target.value); if (!host) setHost(e.target.value); }}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Home team…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="self-center text-muted text-sm">vs</span>
        <select value={t2} onChange={(e) => setT2(e.target.value)}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Away team…</option>
          {teams.filter((t) => t.id !== t1).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
        placeholder={defaultDate ? new Date(defaultDate).toLocaleDateString() : ""}
        className="w-full border border-border rounded-lg px-2 py-1.5 text-sm" />
      <div className="flex gap-2">
        <button
          disabled={!t1 || !t2 || t1 === t2}
          onClick={async () => { await onAdd(t1, t2, host || t1, date || (defaultDate ?? null)); close(); }}
          className="flex-1 bg-action-dark text-white py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
        >Add event</button>
        <button onClick={close}
          className="flex-1 bg-gray-200 py-1.5 rounded-lg text-xs font-medium">Cancel</button>
      </div>
    </div>
  );
}

interface RoundFormValues {
  roundNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  configOverride: { maxPointsPerMatchDay?: number; maxMatchesPerEvent?: number; allowCrossCategoryPlay?: boolean } | null;
  categoriesOverride: { id: string; name?: string; ageGroup?: string; skillMin?: number | null; skillMax?: number | null; scoringFormat?: string; winBy?: string; maxPerEvent?: number | null }[] | null;
}

interface RoundFormProps {
  mode: "add" | "edit";
  initial: RoundFormValues;
  leagueCategories: LeagueCategory[];
  leagueConfig: { maxPointsPerMatchDay?: number; maxMatchesPerEvent?: number; allowCrossCategoryPlay?: boolean } | null;
  onSubmit: (v: RoundFormValues) => Promise<void> | void;
  onCancel: () => void;
}

type CatOverrideForm = {
  included: boolean;
  expanded: boolean;
  name: string;
  ageGroup: string;
  skillMin: string;
  skillMax: string;
  scoringFormat: string;
  winBy: string;
  maxPerEvent: string;
};

function RoundForm({ mode, initial, leagueCategories, leagueConfig, onSubmit, onCancel }: RoundFormProps) {
  const [roundNumber, setRoundNumber] = useState(initial.roundNumber);
  const [name, setName] = useState(initial.name);
  const [start, setStart] = useState(initial.startDate);
  const [end, setEnd] = useState(initial.endDate);

  const cfg = initial.configOverride;
  const [useFormatOverride, setUseFormatOverride] = useState(!!cfg);
  const [maxPts, setMaxPts] = useState(cfg?.maxPointsPerMatchDay != null ? String(cfg.maxPointsPerMatchDay) : "");
  const [maxMatches, setMaxMatches] = useState(cfg?.maxMatchesPerEvent != null ? String(cfg.maxMatchesPerEvent) : "");
  const [crossCat, setCrossCat] = useState<"inherit" | "allow" | "deny">(
    cfg?.allowCrossCategoryPlay === true ? "allow" : cfg?.allowCrossCategoryPlay === false ? "deny" : "inherit"
  );

  const initialCatMap: Record<string, CatOverrideForm> = useMemo(() => {
    const out: Record<string, CatOverrideForm> = {};
    const overrideById = new Map((initial.categoriesOverride ?? []).map((o) => [o.id, o]));
    for (const c of leagueCategories) {
      const o = overrideById.get(c.id);
      out[c.id] = {
        included: initial.categoriesOverride ? !!o : true,
        expanded: false,
        name: o?.name ?? "",
        ageGroup: o?.ageGroup ?? "",
        skillMin: o?.skillMin != null ? String(o.skillMin) : "",
        skillMax: o?.skillMax != null ? String(o.skillMax) : "",
        scoringFormat: o?.scoringFormat ?? "",
        winBy: o?.winBy ?? "",
        maxPerEvent: o?.maxPerEvent != null ? String(o.maxPerEvent) : "",
      };
    }
    return out;
  }, [initial.categoriesOverride, leagueCategories]);

  const [useCategoriesOverride, setUseCategoriesOverride] = useState(!!initial.categoriesOverride);
  const [catOverrides, setCatOverrides] = useState<Record<string, CatOverrideForm>>(initialCatMap);

  // Re-initialise categoriesOverride state when categories list / initial changes
  useEffect(() => { setCatOverrides(initialCatMap); }, [initialCatMap]);

  const handleSave = async () => {
    let configOverride: RoundFormValues["configOverride"] = null;
    if (useFormatOverride) {
      const c: NonNullable<RoundFormValues["configOverride"]> = {};
      const mp = parseInt(maxPts, 10);
      const mm = parseInt(maxMatches, 10);
      if (!isNaN(mp) && maxPts !== "") c.maxPointsPerMatchDay = mp;
      if (!isNaN(mm) && maxMatches !== "") c.maxMatchesPerEvent = mm;
      if (crossCat === "allow") c.allowCrossCategoryPlay = true;
      else if (crossCat === "deny") c.allowCrossCategoryPlay = false;
      if (Object.keys(c).length > 0) configOverride = c;
    }

    let categoriesOverride: RoundFormValues["categoriesOverride"] = null;
    if (useCategoriesOverride) {
      categoriesOverride = [];
      for (const cat of leagueCategories) {
        const o = catOverrides[cat.id];
        if (!o || !o.included) continue;
        const row: NonNullable<RoundFormValues["categoriesOverride"]>[number] = { id: cat.id };
        if (o.name.trim() && o.name.trim() !== cat.name) row.name = o.name.trim();
        if (o.ageGroup.trim() && o.ageGroup.trim() !== cat.ageGroup) row.ageGroup = o.ageGroup.trim();
        if (o.skillMin !== "") row.skillMin = parseFloat(o.skillMin);
        if (o.skillMax !== "") row.skillMax = parseFloat(o.skillMax);
        if (o.scoringFormat.trim() && o.scoringFormat.trim() !== cat.scoringFormat) row.scoringFormat = o.scoringFormat.trim();
        if (o.winBy.trim() && o.winBy.trim() !== cat.winBy) row.winBy = o.winBy.trim();
        if (o.maxPerEvent !== "") row.maxPerEvent = parseInt(o.maxPerEvent, 10);
        categoriesOverride.push(row);
      }
    }

    await onSubmit({
      roundNumber, name, startDate: start, endDate: end,
      configOverride, categoriesOverride,
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex gap-3">
        <div className="w-20">
          <label className="block text-xs text-muted mb-1">Round #</label>
          <input type="number" value={roundNumber}
            onChange={(e) => setRoundNumber(parseInt(e.target.value) || 1)} min={1}
            className="w-full border border-border rounded-lg px-2 py-2 text-sm" />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={`Round ${roundNumber}`}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Start date</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">End date</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
            min={start || undefined}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={useFormatOverride}
            onChange={(e) => setUseFormatOverride(e.target.checked)} className="rounded" />
          <span className="text-sm font-medium">Override format for this round</span>
        </label>
        {useFormatOverride && (
          <div className="mt-2 space-y-2 pl-6">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] text-muted">Max pts / match-day</label>
                <input type="number" min={1} value={maxPts}
                  onChange={(e) => setMaxPts(e.target.value)}
                  placeholder={String(leagueConfig?.maxPointsPerMatchDay ?? 3)}
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] text-muted">Max matches / event</label>
                <input type="number" min={1} value={maxMatches}
                  onChange={(e) => setMaxMatches(e.target.value)}
                  placeholder={leagueConfig?.maxMatchesPerEvent != null ? String(leagueConfig.maxMatchesPerEvent) : "—"}
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">Cross-category play</label>
              <select value={crossCat} onChange={(e) => setCrossCat(e.target.value as typeof crossCat)}
                className="w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="inherit">Inherit from league</option>
                <option value="allow">Allow</option>
                <option value="deny">Disallow</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={useCategoriesOverride}
            onChange={(e) => setUseCategoriesOverride(e.target.checked)} className="rounded" />
          <span className="text-sm font-medium">Customize categories for this round</span>
        </label>
        {useCategoriesOverride && (
          <div className="mt-2 space-y-1.5 pl-6">
            {leagueCategories.length === 0 && (
              <p className="text-[11px] text-muted">No league categories yet.</p>
            )}
            {leagueCategories.map((c) => {
              const o = catOverrides[c.id];
              if (!o) return null;
              const update = (patch: Partial<CatOverrideForm>) => {
                setCatOverrides((prev) => ({ ...prev, [c.id]: { ...o, ...patch } }));
              };
              return (
                <div key={c.id} className="border border-border rounded-lg p-2 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={o.included} onChange={(e) => update({ included: e.target.checked })} className="rounded" />
                    <span className={`text-sm flex-1 truncate ${!o.included ? "line-through text-muted" : ""}`}>{c.name}</span>
                    {o.included && (
                      <button onClick={() => update({ expanded: !o.expanded })}
                        className="text-[10px] text-action font-medium">
                        {o.expanded ? "Hide" : "Edit"}
                      </button>
                    )}
                  </div>
                  {o.included && o.expanded && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-muted">Name</label>
                          <input value={o.name} onChange={(e) => update({ name: e.target.value })}
                            placeholder={c.name}
                            className="w-full border border-border rounded px-2 py-1 text-xs" />
                        </div>
                        <div className="w-24">
                          <label className="block text-[10px] text-muted">Age group</label>
                          <input value={o.ageGroup} onChange={(e) => update({ ageGroup: e.target.value })}
                            placeholder={c.ageGroup}
                            className="w-full border border-border rounded px-2 py-1 text-xs" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-muted">Skill min</label>
                          <input type="number" step={0.1} value={o.skillMin}
                            onChange={(e) => update({ skillMin: e.target.value })}
                            placeholder={c.skillMin != null ? String(c.skillMin) : "—"}
                            className="w-full border border-border rounded px-2 py-1 text-xs" />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] text-muted">Skill max</label>
                          <input type="number" step={0.1} value={o.skillMax}
                            onChange={(e) => update({ skillMax: e.target.value })}
                            placeholder={c.skillMax != null ? String(c.skillMax) : "—"}
                            className="w-full border border-border rounded px-2 py-1 text-xs" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-muted">Scoring</label>
                          <input value={o.scoringFormat} onChange={(e) => update({ scoringFormat: e.target.value })}
                            placeholder={c.scoringFormat}
                            className="w-full border border-border rounded px-2 py-1 text-xs" />
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-muted">Win by</label>
                          <input value={o.winBy} onChange={(e) => update({ winBy: e.target.value })}
                            placeholder={c.winBy}
                            className="w-full border border-border rounded px-2 py-1 text-xs" />
                        </div>
                        <div className="w-24">
                          <label className="block text-[10px] text-muted">Max / event</label>
                          <input type="number" min={0} value={o.maxPerEvent}
                            onChange={(e) => update({ maxPerEvent: e.target.value })}
                            placeholder={c.maxPerEvent != null ? String(c.maxPerEvent) : "—"}
                            className="w-full border border-border rounded px-2 py-1 text-xs" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={!roundNumber}
          className="flex-1 bg-action-dark text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {mode === "add" ? "Add Round" : "Save"}
        </button>
        <button onClick={onCancel}
          className="flex-1 bg-gray-100 py-2 rounded-lg text-sm font-medium">Cancel</button>
      </div>
    </div>
  );
}

export default function LeagueDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { viewRole } = useViewRole();
  const { confirm } = useConfirm();
  const userId = (session?.user as { id?: string })?.id;
  const userRole = (session?.user as { role?: string })?.role;

  // Preview cache: shows the header (name/season/status/description) instantly
  // on navigation from the leagues list. Replaced with full data when fetch returns.
  const preview = typeof id === "string" ? getPreview<LeaguePreview>("league", id) : null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [league, setLeague] = useState<League | null>(null);
  const [standings, setStandings] = useState<{ general: Standing[]; categoryStandings: Record<string, { teamId: string; teamName: string; wins: number; losses: number }[]>; categories: LeagueCategory[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [editSection, setEditSection] = useState<"" | "info" | "format" | "categories" | "editCat" | "newCat" | "management" | "editTeam" | "addPlayer" | "requests">("");
  const [editCatIdx, setEditCatIdx] = useState(0);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [allClubs, setAllClubs] = useState<{ id: string; name: string; emoji: string }[]>([]);

  // Eligibility state
  const [eligibility, setEligibility] = useState<{ minMatchDays: number; teams: { teamId: string; teamName: string; players: { playerId: string; name: string; matchDaysPlayed: number; eligible: boolean }[] }[] } | null>(null);
  const fetchEligibility = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}/eligibility`);
    if (r.ok) setEligibility(await r.json());
  }, [id]);

  // League matches state
  interface LeagueMatch {
    id: string; courtNum: number; round: number; status: string; createdAt: string;
    players: { id: string; playerId: string; team: number; score: number; player: { id: string; name: string; emoji: string; photoUrl?: string | null } }[];
    roundNumber: number; roundName: string; eventId: string;
    teams: { id: string; name: string }[];
    event: { id: string; name: string; date: string };
  }
  const [leagueMatches, setLeagueMatches] = useState<LeagueMatch[]>([]);
  const [matchesLoaded, setMatchesLoaded] = useState(false);
  const [matchRoundFilter, setMatchRoundFilter] = useState("");
  const [matchTeamFilter, setMatchTeamFilter] = useState("");
  const [matchStatusFilter, setMatchStatusFilter] = useState("");

  // Team edit state (used for both add and edit)
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null); // null = creating new
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [editTeamName, setEditTeamName] = useState("");
  const [editTeamSlogan, setEditTeamSlogan] = useState("");
  const [editTeamClubId, setEditTeamClubId] = useState("");
  const [editTeamCaptainId, setEditTeamCaptainId] = useState("");
  const [editTeamViceCaptainId, setEditTeamViceCaptainId] = useState("");
  const [editTeamLogoUrl, setEditTeamLogoUrl] = useState<string | null>(null);
  const [editTeamPhotoUrl, setEditTeamPhotoUrl] = useState<string | null>(null);
  const [editTeamLogoFile, setEditTeamLogoFile] = useState<File | null>(null);
  const [editTeamLogoPreview, setEditTeamLogoPreview] = useState<string | null>(null);
  const [editTeamPhotoFile, setEditTeamPhotoFile] = useState<File | null>(null);
  const [editTeamPhotoPreview, setEditTeamPhotoPreview] = useState<string | null>(null);
  const [showTeamCaptainPicker, setShowTeamCaptainPicker] = useState(false);
  const [showTeamVicePicker, setShowTeamVicePicker] = useState(false);
  const [teamCaptainSearch, setTeamCaptainSearch] = useState("");
  const [teamViceSearch, setTeamViceSearch] = useState("");

  // Add round state
  const [showAddRound, setShowAddRound] = useState(false);
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const [newRoundNumber, setNewRoundNumber] = useState(1);
  // Round form state lives inside RoundForm; only the round number is
  // tracked here so it can default to (rounds.length + 1) when adding.

  // Add player to team state (modal)
  const [addPlayerTeam, setAddPlayerTeam] = useState<LeagueTeam | null>(null);
  const [addPlayerFilter, setAddPlayerFilter] = useState<"all" | "club">("club");
  const [addPlayerGender, setAddPlayerGender] = useState<"all" | "M" | "F">("all");
  const [addPlayerSearch, setAddPlayerSearch] = useState("");
  const [addedThisSession, setAddedThisSession] = useState<Set<string>>(new Set());
  const [flashSelectedId, setFlashSelectedId] = useState<string | null>(null);
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);
  const [lastAddedName, setLastAddedName] = useState<string | null>(null);
  const [removingPlayerId, setRemovingPlayerId] = useState<string | null>(null);
  const [lastRemovedName, setLastRemovedName] = useState<string | null>(null);
  // Participation requests (loaded on demand for the review page)
  interface RequestDetail {
    id: string;
    playerId: string;
    status: string;
    preferredTeamId: string | null;
    preferredTeam: { id: string; name: string } | null;
    preferences: Record<string, { level: "prefer" | "ok" | "no"; note?: string }> | null;
    player: { id: string; name: string; photoUrl?: string | null; gender?: string | null; rating?: number };
  }
  const [requestList, setRequestList] = useState<RequestDetail[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [clubMembersCache, setClubMembersCache] = useState<Record<string, Player[]>>({});

  // Edit state
  const [dirty, setDirty] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLeagueClubId, setEditLeagueClubId] = useState("");
  const [editVisibility, setEditVisibility] = useState<"public" | "participants">("public");
  const [editDescription, setEditDescription] = useState("");
  const [editSeason, setEditSeason] = useState("");
  const [editStatus, setEditStatus] = useState("");
  // Numeric edit fields are stored as strings so the user can clear them
  // freely while typing. They are parsed to numbers on save.
  const [editMaxRoster, setEditMaxRoster] = useState("14");
  const [editMaxPoints, setEditMaxPoints] = useState("3");
  const [editMinMatchDays, setEditMinMatchDays] = useState("2");
  const [editMaxMatchesPerEvent, setEditMaxMatchesPerEvent] = useState("");
  const [editAllowCrossCategory, setEditAllowCrossCategory] = useState(true);
  const [editDeputyId, setEditDeputyId] = useState("");
  const [helperSearch, setHelperSearch] = useState("");
  const [showAddHelper, setShowAddHelper] = useState(false);
  const [showDeputyPicker, setShowDeputyPicker] = useState(false);
  const [deputySearch, setDeputySearch] = useState("");
  const [showTransferPicker, setShowTransferPicker] = useState(false);
  const [transferSearch, setTransferSearch] = useState("");

  // Edit categories state
  const [editCats, setEditCats] = useState<LeagueCategory[]>([]);
  const [addingCat, setAddingCat] = useState(false);
  const [dirtyCats, setDirtyCats] = useState<Set<string>>(new Set());
  const [newCatName, setNewCatName] = useState("");
  const [newCatFormat, setNewCatFormat] = useState("doubles");
  const [newCatGender, setNewCatGender] = useState("open");
  const [newCatAge, setNewCatAge] = useState("open");
  const [newCatSkillMin, setNewCatSkillMin] = useState("");
  const [newCatSkillMax, setNewCatSkillMax] = useState("");
  const [newCatScoring, setNewCatScoring] = useState("3x11");
  const [newCatWinBy, setNewCatWinBy] = useState("2");

  const fetchLeague = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}`);
    if (!r.ok) { console.error("League fetch failed", r.status, await r.text().catch(() => "")); router.push("/leagues"); return; }
    const data = await r.json();
    setLeague(data);
    setLoading(false);
    // Refresh preview cache so the next visit renders header instantly with current data.
    if (typeof id === "string") {
      setPreview<LeaguePreview>("league", id, {
        id: data.id, name: data.name, description: data.description ?? null,
        season: data.season ?? null, status: data.status, club: data.club ?? null,
      });
    }
    // Set next round number
    setNewRoundNumber((data.rounds?.length || 0) + 1);
  }, [id, router]);

  const fetchStandings = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}/standings`);
    if (r.ok) setStandings(await r.json());
  }, [id]);

  useEffect(() => { fetchLeague(); fetchStandings(); }, [fetchLeague, fetchStandings]);

  // Poll the league every 30s while the tab is visible so roster changes
  // (e.g. someone leaving a team) and request updates show up without a
  // manual refresh. Pauses while the tab is hidden to avoid background work.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => { fetchLeague(); }, 30_000);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => { document.visibilityState === "visible" ? start() : stop(); };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); stop(); };
  }, [fetchLeague]);

  const fetchLeagueMatches = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}/matches`);
    if (r.ok) { setLeagueMatches(await r.json()); setMatchesLoaded(true); }
  }, [id]);

  // Lazy-load matches when tab is selected
  useEffect(() => { if (tab === "matches" && !matchesLoaded) fetchLeagueMatches(); }, [tab, matchesLoaded, fetchLeagueMatches]);

  // Always fetch fresh participation requests when entering the requests
  // section or when the tab regains focus — preferences can change while a
  // captain is reviewing.
  const fetchParticipationRequests = useCallback(async () => {
    setRequestsLoading(true);
    const r = await fetch(`/api/leagues/${id}/participation-requests`);
    if (r.ok) setRequestList(await r.json());
    setRequestsLoading(false);
  }, [id]);
  useEffect(() => {
    if (editSection !== "requests") return;
    fetchParticipationRequests();
    const onFocus = () => { if (document.visibilityState === "visible") fetchParticipationRequests(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [editSection, fetchParticipationRequests]);

  // Hide bottom nav when in edit views
  useEffect(() => {
    const nav = document.querySelector("nav.fixed.bottom-0");
    if (editSection) nav?.classList.add("hidden");
    else nav?.classList.remove("hidden");
    return () => { nav?.classList.remove("hidden"); };
  }, [editSection]);

  const fetchPlayers = async () => { if (allPlayers.length) return; const r = await fetch("/api/players"); if (r.ok) setAllPlayers(await r.json()); };
  const fetchClubs = async () => { if (allClubs.length) return; const r = await fetch("/api/clubs/browse"); if (r.ok) setAllClubs(await r.json()); };

  if (loading || !league) {
    const showPreview = mounted && preview;
    const statusPill = (s: string) =>
      s === "active" ? "bg-green-100 text-green-700" :
      s === "complete" ? "bg-gray-100 text-muted" :
      s === "registration" ? "bg-amber-100 text-amber-700" :
      s === "forming" ? "bg-orange-100 text-orange-700" :
      "bg-blue-100 text-blue-700";
    return (
      <div className="space-y-4">
        <Link href="/leagues" className="text-sm text-action">&larr; Leagues</Link>
        {showPreview ? (
          <>
            <div>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold">{preview.name}</h2>
                  <span className="text-sm text-muted">Season {preview.season || "—"}</span>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${statusPill(preview.status)}`}>{preview.status === "forming" ? "registration closed" : preview.status === "registration" ? "registration open" : preview.status}</span>
              </div>
              {preview.description && <p className="text-sm text-muted mt-1">{preview.description}</p>}
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {(["overview", "teams", "standings", "rounds", "matches"] as const).map((t) => (
                <div key={t} className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize text-center ${
                  t === "overview" ? "bg-white text-foreground shadow-sm" : "text-muted"
                }`}>{t}</div>
              ))}
            </div>
            <div className="bg-card rounded-xl border border-border p-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/3 mb-3" />
              <div className="h-3 bg-gray-200 rounded w-2/3 mb-3" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          </>
        ) : (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }

  const isAppAdmin = userRole === "admin" && hasRole(viewRole, "admin");
  // Admins toggling "view as" downgrade their effective league powers; for
  // non-admins, roles are based purely on the actual relationship.
  // Club role is club-scoped — it does NOT inherit league powers. Admin
  // viewing as Club should see leagues exactly like a User would. League
  // powers stay only for the explicit "league" / "admin" roles.
  const leaguePowersAllowed = userRole !== "admin" || viewRole === "league" || viewRole === "admin";
  const isDirector = leaguePowersAllowed && league.createdBy?.id === userId;
  const isDeputy = leaguePowersAllowed && league.deputy?.id === userId;
  const isHelper = leaguePowersAllowed && (league.helpers?.some((h) => h.playerId === userId) ?? false);
  const canEdit = isAppAdmin || isDirector || isDeputy || isHelper;

  const startEditInfo = () => {
    setEditName(league.name);
    setEditDescription(league.description || "");
    setEditSeason(league.season || "");
    setEditStatus(league.status);
    setEditLeagueClubId(league.club?.id || league.clubId || "");
    setEditVisibility(league.visibility === "participants" ? "participants" : "public");
    setEditMaxRoster(String(league.config?.maxRoster ?? 14));
    setEditMaxPoints(String(league.config?.maxPointsPerMatchDay ?? 3));
    setEditMinMatchDays(String(league.config?.minMatchDaysForPlayoff ?? 2));
    setEditMaxMatchesPerEvent(league.config?.maxMatchesPerEvent != null ? String(league.config.maxMatchesPerEvent) : "");
    setEditAllowCrossCategory(league.config?.allowCrossCategoryPlay !== false);
    setEditDeputyId(league.deputy?.id || "");
    setShowAddHelper(false);
    setHelperSearch("");
    setDirty(false);
    fetchClubs();
    setEditSection("info");
  };

  const saveInfo = async () => {
    const r = await fetch(`/api/leagues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        description: editDescription.trim() || null,
        season: editSeason.trim() || null,
        status: editStatus,
        clubId: editLeagueClubId || null,
        visibility: editVisibility,
        config: {
          ...(league.config || {}),
          maxRoster: parseInt(editMaxRoster, 10) || 14,
          maxPointsPerMatchDay: parseInt(editMaxPoints, 10) || 3,
          minMatchDaysForPlayoff: editMinMatchDays.trim() === "" ? 0 : parseInt(editMinMatchDays, 10) || 0,
          maxMatchesPerEvent: editMaxMatchesPerEvent.trim() === "" ? null : parseInt(editMaxMatchesPerEvent, 10) || null,
          allowCrossCategoryPlay: editAllowCrossCategory,
        },
        deputyId: editDeputyId || null,
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || "Failed to save league");
      return;
    }
    setEditSection("");
    fetchLeague();
  };

  const addHelper = async (playerId: string) => {
    await fetch(`/api/leagues/${id}/helpers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    setHelperSearch("");
    fetchLeague();
  };

  const removeHelper = async (playerId: string) => {
    await fetch(`/api/leagues/${id}/helpers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchLeague();
  };

  const startEditCategories = () => {
    setEditCats(league.categories.map((c) => ({ ...c })));
    setDirty(false);
    setEditSection("categories");
  };

  const saveCategoryEdit = async (cat: LeagueCategory) => {
    const r = await fetch(`/api/leagues/${id}/categories`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: cat.id,
        name: cat.name,
        format: cat.format,
        gender: cat.gender,
        ageGroup: cat.ageGroup,
        skillMin: cat.skillMin,
        skillMax: cat.skillMax,
        scoringFormat: cat.scoringFormat,
        winBy: cat.winBy,
        status: cat.status,
        maxPerEvent: cat.maxPerEvent ?? null,
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || `Failed to save category (${r.status})`);
      throw new Error(d.error || "save failed");
    }
  };

  const deleteCategory = async (catId: string) => {
    const ok = await confirm({ title: "Delete category", message: "Delete this category? Any games in it will also be deleted.", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await fetch(`/api/leagues/${id}/categories`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: catId }),
    });
    setEditCats((prev) => prev.filter((c) => c.id !== catId));
    fetchLeague();
  };

  const autoCatName = (format = newCatFormat, gender = newCatGender, age = newCatAge, sMin = newCatSkillMin, sMax = newCatSkillMax) =>
    buildCatName({ format, gender, ageGroup: age, skillMin: sMin, skillMax: sMax });

  const addCategory = async () => {
    const name = autoCatName();
    if (!name) return;
    const r = await fetch(`/api/leagues/${id}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, format: newCatFormat, gender: newCatGender, ageGroup: newCatAge,
        skillMin: newCatSkillMin ? parseFloat(newCatSkillMin) : null,
        skillMax: newCatSkillMax ? parseFloat(newCatSkillMax) : null,
        scoringFormat: newCatScoring, winBy: newCatWinBy,
      }),
    });
    if (r.ok) {
      setNewCatFormat("doubles"); setNewCatGender("open"); setNewCatAge("open");
      setNewCatSkillMin(""); setNewCatSkillMax(""); setNewCatScoring("3x11"); setNewCatWinBy("2");
      await fetchLeague();
    } else {
      const d = await r.json().catch(() => ({}));
      alert(d.error || "Failed to add category");
    }
  };

  const saveAllCategories = async () => {
    for (const cat of editCats) await saveCategoryEdit(cat);
    setEditSection("");
    fetchLeague();
  };

  const openAddPlayer = async (team: LeagueTeam) => {
    setAddPlayerTeam(team);
    setAddPlayerSearch("");
    setAddPlayerGender("all");
    setLastAddedName(null);
    setAddingPlayerId(null);
    setAddedThisSession(new Set());
    setFlashSelectedId(null);
    const clubId = team.clubId || team.club?.id;
    setAddPlayerFilter(clubId ? "club" : "all");
    // make sure the team is expanded when we return
    setCollapsedTeams((prev) => { const n = new Set(prev); n.delete(team.id); return n; });
    setEditSection("addPlayer");
    fetchPlayers();
    if (clubId && !clubMembersCache[clubId]) {
      const r = await fetch(`/api/clubs/${clubId}`);
      if (r.ok) {
        const club = await r.json();
        const members: Player[] = (club.members || []).map((m: { player: Player }) => m.player);
        setClubMembersCache((prev) => ({ ...prev, [clubId]: members }));
      }
    }
  };

  const closeAddPlayer = () => {
    setAddPlayerTeam(null);
    setLastAddedName(null);
    setAddingPlayerId(null);
    setAddedThisSession(new Set());
    setFlashSelectedId(null);
    setEditSection("");
    setTab("teams");
  };

  const openTeamEdit = (team: LeagueTeam | null) => {
    if (team) {
      setEditingTeamId(team.id);
      setEditTeamName(team.name);
      setEditTeamSlogan(team.slogan || "");
      setEditTeamClubId(team.clubId || team.club?.id || "");
      setEditTeamCaptainId(team.captain?.id || "");
      setEditTeamViceCaptainId(team.viceCaptain?.id || "");
      setEditTeamLogoUrl(team.logoUrl || null);
      setEditTeamPhotoUrl(team.photoUrl || null);
    } else {
      setEditingTeamId(null);
      setEditTeamName(""); setEditTeamSlogan(""); setEditTeamClubId("");
      setEditTeamCaptainId(""); setEditTeamViceCaptainId("");
      setEditTeamLogoUrl(null); setEditTeamPhotoUrl(null);
    }
    setEditTeamLogoFile(null); setEditTeamLogoPreview(null);
    setEditTeamPhotoFile(null); setEditTeamPhotoPreview(null);
    setShowTeamCaptainPicker(false); setShowTeamVicePicker(false);
    setTeamCaptainSearch(""); setTeamViceSearch("");
    setDirty(false);
    fetchClubs();
    fetchPlayers();
    setEditSection("editTeam");
  };

  const saveTeamEdit = async () => {
    const name = editTeamName.trim();
    if (!name) { alert("Team name required"); return; }
    let teamId = editingTeamId;
    // Captains can edit name + slogan + photos. Only league managers can
    // change captain/vice or relink the club.
    const body: Record<string, unknown> = {
      name,
      slogan: editTeamSlogan.trim() || null,
    };
    if (canEdit) {
      body.clubId = editTeamClubId || null;
      body.captainId = editTeamCaptainId || null;
      body.viceCaptainId = editTeamViceCaptainId || null;
    }
    if (teamId) {
      const r = await fetch(`/api/leagues/${id}/teams/${teamId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed to save team"); return; }
    } else {
      // Creation always requires manager fields.
      body.name = name;
      body.clubId = editTeamClubId || null;
      body.captainId = editTeamCaptainId || null;
      body.viceCaptainId = editTeamViceCaptainId || null;
      const r = await fetch(`/api/leagues/${id}/teams`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed to create team"); return; }
      const created = await r.json();
      teamId = created.id;
    }
    if (teamId && editTeamLogoFile) {
      const fd = new FormData();
      fd.append("file", editTeamLogoFile); fd.append("type", "logo");
      await fetch(`/api/leagues/${id}/teams/${teamId}/photo`, { method: "POST", body: fd });
    }
    if (teamId && editTeamPhotoFile) {
      const fd = new FormData();
      fd.append("file", editTeamPhotoFile); fd.append("type", "photo");
      await fetch(`/api/leagues/${id}/teams/${teamId}/photo`, { method: "POST", body: fd });
    }
    setDirty(false);
    setEditSection("");
    fetchLeague();
  };

  const removeTeam = async (teamId: string) => {
    const ok = await confirm({ title: "Delete team", message: "Delete this team and all its players from the league?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await fetch(`/api/leagues/${id}/teams/${teamId}`, { method: "DELETE" });
    fetchLeague();
  };

  const addPlayerToTeam = async (teamId: string, playerId: string): Promise<boolean> => {
    const r = await fetch(`/api/leagues/${id}/teams/${teamId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || `Failed to add player (${r.status})`);
      return false;
    }
    fetchLeague();
    return true;
  };

  const removePlayerFromTeam = async (teamId: string, playerId: string, playerName: string) => {
    const ok = await confirm({
      title: "Remove from team",
      message: `Remove ${playerName} from this team?`,
      confirmText: "Remove",
      danger: true,
    });
    if (!ok) return;
    setRemovingPlayerId(playerId);
    try {
      const r = await fetch(`/api/leagues/${id}/teams/${teamId}/players`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || `Failed to remove player (${r.status})`);
        return;
      }
      await fetchLeague();
      setLastRemovedName(playerName);
      setTimeout(() => setLastRemovedName((cur) => (cur === playerName ? null : cur)), 1800);
    } finally {
      setRemovingPlayerId(null);
    }
  };

  const saveRound = async (mode: "add" | "edit", v: RoundFormValues, roundId?: string) => {
    const url = `/api/leagues/${id}/rounds`;
    const body = JSON.stringify({
      ...(mode === "edit" ? { roundId } : {}),
      ...(mode === "add" ? { roundNumber: v.roundNumber } : {}),
      name: v.name.trim() || undefined,
      startDate: v.startDate || undefined,
      endDate: v.endDate || undefined,
      configOverride: v.configOverride ?? undefined,
      categoriesOverride: v.categoriesOverride ?? undefined,
    });
    const r = await fetch(url, { method: mode === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || "Failed");
      return;
    }
    if (mode === "add") setShowAddRound(false);
    else setEditingRoundId(null);
    fetchLeague(); fetchStandings();
  };

  const deleteRound = async (roundId: string, label: string) => {
    const ok = await confirm({
      title: "Delete round?",
      message: `Delete ${label}? All events, lineups, and games inside this round will be deleted.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/leagues/${id}/rounds`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed"); return; }
    fetchLeague(); fetchStandings();
  };

  const addEventToRound = async (roundId: string, team1Id: string, team2Id: string, hostTeamId: string | null, date: string | null) => {
    const r = await fetch(`/api/leagues/${id}/rounds/${roundId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamIds: [team1Id, team2Id], hostTeamId: hostTeamId || team1Id, date: date || undefined }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed"); return; }
    fetchLeague(); fetchStandings();
  };

  const setGameWinner = async (eventId: string, gameId: string, winnerId: string | null) => {
    await fetch(`/api/leagues/${id}/events/${eventId}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, winnerId }),
    });
    fetchLeague(); fetchStandings();
  };

  const allTeamPlayerIds = new Set(league.teams.flatMap((t) => t.players.map((p) => p.playerId)));

  // ── Shared edit UI helpers ──
  const editBackLink = (target: string, label = "← League") => (
    <div className="sticky top-0 z-30 bg-background -mx-4 px-4 py-2 shadow-sm">
      <button onClick={async () => {
        if (dirty) {
          const ok = await confirm({ title: "Unsaved changes", message: "You have unsaved changes. Discard them?", confirmText: "Discard", danger: true });
          if (!ok) return;
        }
        setDirty(false);
        setEditSection(target as typeof editSection);
      }} className="text-sm text-action font-medium">{label} <span className="text-xs text-muted font-normal">({league.name})</span></button>
    </div>
  );

  const editFooter = (onSave: () => Promise<void>, target: string) => dirty ? (
    <div className="flex gap-2 mt-4">
      <button onClick={async () => { await onSave(); setDirty(false); setEditSection(target as typeof editSection); }}
        className="flex-1 bg-action text-white py-2.5 rounded-xl font-semibold text-sm">Save</button>
      <button onClick={() => { setDirty(false); setEditSection(target as typeof editSection); }}
        className="flex-1 bg-gray-100 text-foreground py-2.5 rounded-xl font-medium text-sm">Cancel</button>
    </div>
  ) : null;

  const d = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => { fn(...args); setDirty(true); };

  // ── Edit section views (clean page) ──
  if (editSection === "info") {
    return (
      <div className="space-y-2">
        {editBackLink("")}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Edit League Info</h3>
          <div>
            <label className="block text-xs text-muted mb-1">Name</label>
            <input type="text" value={editName} onChange={(e) => { setEditName(e.target.value); setDirty(true); }}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Description</label>
            <textarea value={editDescription} onChange={(e) => { setEditDescription(e.target.value); setDirty(true); }} rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Season</label>
              <input type="text" value={editSeason} onChange={(e) => { setEditSeason(e.target.value); setDirty(true); }} placeholder="e.g. 2025/26"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Status</label>
              <select value={editStatus} onChange={(e) => { setEditStatus(e.target.value); setDirty(true); }}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                <option value="setup">Setup</option>
                <option value="registration">Registration open</option>
                <option value="forming">Registration closed</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Organizing Club <span className="opacity-70 font-normal">(optional)</span></label>
            <select value={editLeagueClubId} onChange={(e) => { setEditLeagueClubId(e.target.value); setDirty(true); }}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Independent — no club</option>
              {allClubs.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Visibility</label>
            <div className="flex gap-1">
              <button type="button" onClick={() => { setEditVisibility("public"); setDirty(true); }}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium ${editVisibility === "public" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}>
                🌐 Public
              </button>
              <button type="button" onClick={() => { setEditVisibility("participants"); setDirty(true); }}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium ${editVisibility === "participants" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}>
                🔒 Participants only
              </button>
            </div>
            <p className="text-[10px] text-muted mt-1">{editVisibility === "public" ? "Anyone signed in can see the league." : "Only league participants (team players, captains, helpers, organizers) can see it."}</p>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Documents <span className="opacity-70 font-normal">(rules, schedule, posters · max 5 · PDF/JPG/PNG, 10MB)</span></label>
            <div className="space-y-1.5">
              {(league.documents || []).map((d) => {
                const isImg = d.mimeType.startsWith("image/");
                return (
                  <div key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 flex items-center gap-2 text-sm hover:underline">
                      <span>{isImg ? "🖼️" : "📄"}</span>
                      <span className="truncate font-medium text-action">{d.name}</span>
                      <span className="text-[10px] text-muted shrink-0">{Math.round(d.sizeBytes / 1024)} KB</span>
                    </a>
                    <button type="button" onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await confirm({ title: "Remove document", message: `Remove "${d.name}"?`, danger: true, confirmText: "Remove" });
                      if (!ok) return;
                      const r = await fetch(`/api/leagues/${id}/documents/${d.id}`, { method: "DELETE" });
                      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "Failed to remove"); return; }
                      fetchLeague();
                    }} className="text-danger text-sm w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center" aria-label="Remove">✕</button>
                  </div>
                );
              })}
              {(league.documents?.length || 0) < 5 && (
                <label className="block w-full text-center px-3 py-2 rounded-lg border border-dashed border-border text-sm text-muted hover:bg-gray-50 cursor-pointer">
                  + Upload document
                  <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) { return; }
                    e.target.value = "";
                    const fd = new FormData(); fd.append("file", f);
                    const r = await fetch(`/api/leagues/${id}/documents`, { method: "POST", body: fd });
                    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "Upload failed"); return; }
                    fetchLeague();
                  }} />
                </label>
              )}
            </div>
          </div>
          {editFooter(saveInfo, "")}
        </div>
      </div>
    );
  }

  if (editSection === "format") {
    return (
      <div className="space-y-2">
        {editBackLink("")}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Edit League Format</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Max Roster</label>
              <input type="number" value={editMaxRoster} onChange={(e) => { setEditMaxRoster(e.target.value); setDirty(true); }} min={1}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max Pts / Match Day</label>
              <input type="number" value={editMaxPoints} onChange={(e) => { setEditMaxPoints(e.target.value); setDirty(true); }} min={1}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max league matches / event</label>
              <input type="number" value={editMaxMatchesPerEvent} onChange={(e) => { setEditMaxMatchesPerEvent(e.target.value); setDirty(true); }} min={1}
                placeholder="—"
                className="w-20 border border-border rounded-lg px-3 py-2 text-sm" />
              <p className="text-[10px] text-muted mt-1">Cap for principal games per match-day. Empty = no cap.</p>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Min match days for playoff</label>
              <input type="number" value={editMinMatchDays} onChange={(e) => { setEditMinMatchDays(e.target.value); setDirty(true); }} min={0}
                className="w-20 border border-border rounded-lg px-3 py-2 text-sm" />
              <p className="text-[10px] text-muted mt-1">Minimum match days a player must have appeared in to be eligible for the playoff/Grande Final.</p>
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editAllowCrossCategory}
                onChange={(e) => { setEditAllowCrossCategory(e.target.checked); setDirty(true); }}
                className="rounded" />
              <span className="text-sm font-medium">Allow cross-category play</span>
            </label>
            <p className="text-[10px] text-muted mt-1">If unchecked, a player can only appear in slots of a single category per match-day.</p>
          </div>
          {editFooter(saveInfo, "")}
        </div>
      </div>
    );
  }

  const scoringSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-border rounded-lg px-2 py-1.5 text-xs">
      <optgroup label="Normal — 1 Set"><option value="1x7">1 set to 7</option><option value="1x9">1 set to 9</option><option value="1x11">1 set to 11</option><option value="1x15">1 set to 15</option></optgroup>
      <optgroup label="Normal — Best of 3"><option value="3x11">Bo3 to 11</option><option value="3x15">Bo3 to 15</option></optgroup>
      <optgroup label="Rally — 1 Set"><option value="1xR15">Rally to 15</option><option value="1xR21">Rally to 21</option></optgroup>
      <optgroup label="Rally — Best of 3"><option value="3xR15">Bo3 rally 15</option><option value="3xR21">Bo3 rally 21</option></optgroup>
    </select>
  );
  const winBySelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-border rounded-lg px-2 py-1.5 text-xs">
      <option value="1">1</option><option value="2">2</option>
      <option value="2_gp18">2 (GP@18)</option><option value="2_gp21">2 (GP@21)</option>
      <option value="cap13">GP 13</option><option value="cap15">GP 15</option><option value="cap17">GP 17</option>
      <option value="cap18">GP 18</option><option value="cap23">GP 23</option><option value="cap25">GP 25</option>
    </select>
  );
  const AGE_OPTS = ["open", "18+", "35+", "50+", "55+", "60+", "65+", "70+"];
  const SKILL_OPTS = ["", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0"];

  const scoringLabel = (v: string) => {
    const m: Record<string, string> = { "1x7": "1×7", "1x9": "1×9", "1x11": "1×11", "1x15": "1×15", "3x11": "Bo3×11", "3x15": "Bo3×15", "1xR15": "Rally 15", "1xR21": "Rally 21", "3xR15": "Bo3R15", "3xR21": "Bo3R21" };
    return m[v] || v;
  };
  const genderLabel = (v: string) => ({ male: "Men", female: "Women", mix: "Mixed", open: "Open" }[v] || v);

  if (editSection === "categories") {
    return (
      <div className="space-y-2">
        {editBackLink("")}
        <h3 className="text-sm font-semibold px-1">Categories</h3>
        {league.categories.map((cat, idx) => (
          <div key={cat.id} onClick={() => { setEditCats(league.categories.map((c) => ({ ...c }))); setEditCatIdx(idx); setDirty(false); setEditSection("editCat"); }}
            className="bg-card rounded-xl border border-border p-3 flex items-center gap-2 active:opacity-70 cursor-pointer">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{cat.name}</p>
              <p className="text-xs text-muted">{cat.format} · {genderLabel(cat.gender)}{cat.ageGroup !== "open" ? ` · ${cat.ageGroup}` : ""} · {scoringLabel(cat.scoringFormat)} · win by {cat.winBy}{cat.maxPerEvent != null ? ` · max ${cat.maxPerEvent}/event` : ""}</p>
            </div>
            {cat.status === "draft" && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Draft</span>}
            <span className="text-muted shrink-0"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></span>
          </div>
        ))}
        <button onClick={() => { setNewCatFormat("doubles"); setNewCatGender("open"); setNewCatAge("open"); setNewCatSkillMin(""); setNewCatSkillMax(""); setNewCatScoring("3x11"); setNewCatWinBy("2"); setDirty(false); setEditSection("newCat"); }}
          className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5">+ Add Category</button>
      </div>
    );
  }

  if (editSection === "editCat") {
    const cat = editCats[editCatIdx];
    if (!cat) { setEditSection("categories"); return null; }
    const updateCat = (field: string, value: unknown) => {
      const updated = { ...editCats[editCatIdx], [field]: value };
      const nameParts = [];
      const g = field === "gender" ? value as string : cat.gender;
      const f = field === "format" ? value as string : cat.format;
      const a = field === "ageGroup" ? value as string : cat.ageGroup;
      const sMin = field === "skillMin" ? value as number | null : cat.skillMin;
      const sMax = field === "skillMax" ? value as number | null : cat.skillMax;
      if (g !== "open") nameParts.push(g === "male" ? "Men's" : g === "female" ? "Women's" : "Mixed");
      nameParts.push(f === "doubles" ? "Doubles" : "Singles");
      if (a !== "open") nameParts.push(a);
      if (sMin || sMax) nameParts.push(`${sMin || ""}${sMin && sMax ? "-" : ""}${sMax || ""}+`);
      updated.name = nameParts.join(" ") || "Open";
      const c = [...editCats]; c[editCatIdx] = updated; setEditCats(c);
      setDirty(true);
    };
    return (
      <div className="space-y-2">
        {editBackLink("categories", "← Categories")}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{cat.name}</h3>
            <button onClick={() => updateCat("status", cat.status === "draft" ? "active" : "draft")}
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cat.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
              {cat.status === "draft" ? "Draft" : "Active"}
            </button>
          </div>
          <div><label className="block text-xs text-muted mb-1">Format</label><select value={cat.format} onChange={(e) => updateCat("format", e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm"><option value="doubles">Doubles</option><option value="singles">Singles</option></select></div>
          <div><label className="block text-xs text-muted mb-1">Gender</label><select value={cat.gender} onChange={(e) => updateCat("gender", e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm"><option value="open">Open</option><option value="male">Men</option><option value="female">Women</option><option value="mix">Mixed</option></select></div>
          <div><label className="block text-xs text-muted mb-1">Age Group</label><select value={cat.ageGroup} onChange={(e) => updateCat("ageGroup", e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm">{AGE_OPTS.map((a) => <option key={a} value={a}>{a === "open" ? "Open" : a}</option>)}</select></div>
          <div><label className="block text-xs text-muted mb-1">Level (DUPR)</label><div className="flex items-center gap-1.5">
            <select value={cat.skillMin != null ? cat.skillMin.toFixed(1) : ""} onChange={(e) => updateCat("skillMin", e.target.value ? parseFloat(e.target.value) : null)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">
              <option value="" disabled hidden>From</option>
              <option value="">–</option>
              {SKILL_OPTS.filter((s) => s).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-muted">–</span>
            <select value={cat.skillMax != null ? cat.skillMax.toFixed(1) : ""} onChange={(e) => updateCat("skillMax", e.target.value ? parseFloat(e.target.value) : null)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">
              <option value="" disabled hidden>To</option>
              <option value="">–</option>
              {SKILL_OPTS.filter((s) => s).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs text-muted mb-1">Scoring</label>{scoringSelect(cat.scoringFormat, (v) => updateCat("scoringFormat", v))}</div><div><label className="block text-xs text-muted mb-1">Win by</label>{winBySelect(cat.winBy, (v) => updateCat("winBy", v))}</div></div>
          <div>
            <label className="block text-xs text-muted mb-1">Max matches per event <span className="opacity-70 font-normal">(empty = no cap)</span></label>
            <input
              type="number"
              min={0}
              max={99}
              value={cat.maxPerEvent ?? ""}
              onChange={(e) => updateCat("maxPerEvent", e.target.value === "" ? null : (parseInt(e.target.value, 10) || 0))}
              placeholder="—"
              className="w-20 border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {editFooter(async () => { await saveCategoryEdit(cat); fetchLeague(); }, "categories")}
          <button onClick={async () => { await deleteCategory(cat.id); setDirty(false); setEditSection("categories"); }}
            className="w-full py-2 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50">Remove Category</button>
        </div>
      </div>
    );
  }

  if (editSection === "newCat") {
    return (
      <div className="space-y-2">
        {editBackLink("categories", "← Categories")}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">New Category</h3>
          <div><label className="block text-xs text-muted mb-1">Format</label><select value={newCatFormat} onChange={(e) => setNewCatFormat(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm"><option value="doubles">Doubles</option><option value="singles">Singles</option></select></div>
          <div><label className="block text-xs text-muted mb-1">Gender</label><select value={newCatGender} onChange={(e) => setNewCatGender(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm"><option value="open">Open</option><option value="male">Men</option><option value="female">Women</option><option value="mix">Mixed</option></select></div>
          <div><label className="block text-xs text-muted mb-1">Age Group</label><select value={newCatAge} onChange={(e) => setNewCatAge(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm">{AGE_OPTS.map((a) => <option key={a} value={a}>{a === "open" ? "Open" : a}</option>)}</select></div>
          <div><label className="block text-xs text-muted mb-1">Level (DUPR)</label><div className="flex items-center gap-1.5">
            <select value={newCatSkillMin} onChange={(e) => setNewCatSkillMin(e.target.value)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">
              <option value="" disabled hidden>From</option>
              <option value="">–</option>
              {SKILL_OPTS.filter((s) => s).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-muted">–</span>
            <select value={newCatSkillMax} onChange={(e) => setNewCatSkillMax(e.target.value)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">
              <option value="" disabled hidden>To</option>
              <option value="">–</option>
              {SKILL_OPTS.filter((s) => s).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs text-muted mb-1">Scoring</label>{scoringSelect(newCatScoring, setNewCatScoring)}</div><div><label className="block text-xs text-muted mb-1">Win by</label>{winBySelect(newCatWinBy, setNewCatWinBy)}</div></div>
          <div className="bg-gray-50 rounded-lg px-3 py-2"><span className="text-xs text-muted">Name: </span><span className="text-sm font-medium">{autoCatName()}</span></div>
          <div className="flex gap-2 mt-4">
            <button onClick={async () => { await addCategory(); setEditSection("categories"); }}
              className="flex-1 bg-action text-white py-2.5 rounded-xl font-semibold text-sm">Add</button>
            <button onClick={() => { setDirty(false); setEditSection("categories"); }}
              className="flex-1 bg-gray-100 text-foreground py-2.5 rounded-xl font-medium text-sm">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  if (editSection === "editTeam") {
    const captainPlayer = editTeamCaptainId ? allPlayers.find((p) => p.id === editTeamCaptainId) : null;
    const vicePlayer = editTeamViceCaptainId ? allPlayers.find((p) => p.id === editTeamViceCaptainId) : null;
    const playerResults = (search: string, excludeIds: string[]) =>
      allPlayers.filter((p) => !excludeIds.includes(p.id) && p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 10);

    return (
      <div className="space-y-2">
        {editBackLink("")}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">{editingTeamId ? "Edit Team" : "Add Team"}</h3>

          <div>
            <label className="block text-xs text-muted mb-1">Team Name</label>
            <input type="text" value={editTeamName}
              onChange={(e) => { setEditTeamName(e.target.value); setDirty(true); }}
              placeholder="e.g. Leiria"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Slogan (optional)</label>
            <input type="text" value={editTeamSlogan}
              onChange={(e) => { setEditTeamSlogan(e.target.value); setDirty(true); }}
              placeholder="e.g. Smashing Champions"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          </div>

          {canEdit && (
            <div>
              <label className="block text-xs text-muted mb-1">Link to Club (optional)</label>
              <select value={editTeamClubId}
                onChange={(e) => {
                  setEditTeamClubId(e.target.value); setDirty(true);
                  if (!editTeamName && e.target.value) {
                    const c = allClubs.find((c) => c.id === e.target.value);
                    if (c) setEditTeamName(c.name);
                  }
                }}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">No club</option>
                {allClubs.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-muted mb-1">Logo</label>
            <div className="flex items-center gap-3">
              {(editTeamLogoPreview || editTeamLogoUrl) ? (
                <img src={editTeamLogoPreview || editTeamLogoUrl || ""} alt="" className="w-14 h-14 rounded object-cover border border-border" />
              ) : (
                <div className="w-14 h-14 rounded bg-gray-100 flex items-center justify-center text-muted text-xs border border-border">No logo</div>
              )}
              <input type="file" accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setEditTeamLogoFile(f); setEditTeamLogoPreview(URL.createObjectURL(f)); setDirty(true); }
                }}
                className="text-xs flex-1" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Team Photo</label>
            <div className="space-y-2">
              {(editTeamPhotoPreview || editTeamPhotoUrl) ? (
                <img src={editTeamPhotoPreview || editTeamPhotoUrl || ""} alt="" className="w-full max-h-48 rounded object-cover border border-border" />
              ) : (
                <div className="w-full h-24 rounded bg-gray-100 flex items-center justify-center text-muted text-xs border border-border">No photo</div>
              )}
              <input type="file" accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setEditTeamPhotoFile(f); setEditTeamPhotoPreview(URL.createObjectURL(f)); setDirty(true); }
                }}
                className="text-xs" />
            </div>
          </div>

          {canEdit && (
          <div>
            <label className="block text-xs text-muted mb-1">Team Leader</label>
            {captainPlayer && !showTeamCaptainPicker ? (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <PlayerAvatar name={captainPlayer.name} photoUrl={captainPlayer.photoUrl} size="xs" />
                <span className="text-sm font-medium flex-1">{captainPlayer.name}</span>
                <button onClick={() => { setEditTeamCaptainId(""); setDirty(true); }} className="text-xs text-danger px-1">✕</button>
                <button onClick={() => { setShowTeamCaptainPicker(true); setTeamCaptainSearch(""); }} className="text-xs text-muted hover:text-foreground">Change</button>
              </div>
            ) : showTeamCaptainPicker ? (
              <div>
                <input type="text" value={teamCaptainSearch}
                  onChange={(e) => setTeamCaptainSearch(e.target.value)}
                  placeholder="Search team leader..." autoFocus
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-sm mb-1" />
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {playerResults(teamCaptainSearch, [editTeamViceCaptainId]).map((p) => (
                    <button key={p.id} onClick={() => { setEditTeamCaptainId(p.id); setShowTeamCaptainPicker(false); setDirty(true); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-left">
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                      <span className="text-sm">{p.name}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowTeamCaptainPicker(false)} className="text-xs text-muted mt-1">Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setShowTeamCaptainPicker(true); setTeamCaptainSearch(""); }}
                className="w-full text-left border border-dashed border-border rounded-lg px-3 py-2 text-sm text-muted hover:bg-gray-50">
                + Select team leader
              </button>
            )}
          </div>
          )}

          {canEdit && (
          <div>
            <label className="block text-xs text-muted mb-1">Deputy</label>
            {vicePlayer && !showTeamVicePicker ? (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <PlayerAvatar name={vicePlayer.name} photoUrl={vicePlayer.photoUrl} size="xs" />
                <span className="text-sm font-medium flex-1">{vicePlayer.name}</span>
                <button onClick={() => { setEditTeamViceCaptainId(""); setDirty(true); }} className="text-xs text-danger px-1">✕</button>
                <button onClick={() => { setShowTeamVicePicker(true); setTeamViceSearch(""); }} className="text-xs text-muted hover:text-foreground">Change</button>
              </div>
            ) : showTeamVicePicker ? (
              <div>
                <input type="text" value={teamViceSearch}
                  onChange={(e) => setTeamViceSearch(e.target.value)}
                  placeholder="Search deputy..." autoFocus
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-sm mb-1" />
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {playerResults(teamViceSearch, [editTeamCaptainId]).map((p) => (
                    <button key={p.id} onClick={() => { setEditTeamViceCaptainId(p.id); setShowTeamVicePicker(false); setDirty(true); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-left">
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                      <span className="text-sm">{p.name}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowTeamVicePicker(false)} className="text-xs text-muted mt-1">Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setShowTeamVicePicker(true); setTeamViceSearch(""); }}
                className="w-full text-left border border-dashed border-border rounded-lg px-3 py-2 text-sm text-muted hover:bg-gray-50">
                + Select deputy
              </button>
            )}
          </div>
          )}

          {editFooter(saveTeamEdit, "")}
        </div>
      </div>
    );
  }

  if (editSection === "management") {
    const playerSearchResults = (search: string, excludeIds: string[]) =>
      allPlayers.filter((p) => !excludeIds.includes(p.id) && p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 10);

    const deputyPlayer = editDeputyId ? allPlayers.find((p) => p.id === editDeputyId) : null;

    return (
      <div className="space-y-2">
        {editBackLink("")}
        {/* Directors */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Directors</h3>

          {/* Director */}
          <div>
            <label className="block text-xs text-muted mb-1">Director</label>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <PlayerAvatar name={league.createdBy?.name || "?"} size="xs" />
              <span className="text-sm font-medium flex-1">{league.createdBy?.name || "—"}</span>
              {(isDirector || isAppAdmin) && !showTransferPicker && (
                <button onClick={() => { setShowTransferPicker(true); setTransferSearch(""); fetchPlayers(); }}
                  className="text-[10px] text-muted hover:text-foreground">Transfer</button>
              )}
            </div>
            {showTransferPicker && (
              <div className="mt-1">
                <input type="text" value={transferSearch} onChange={(e) => setTransferSearch(e.target.value)}
                  placeholder="Search new director..." autoFocus
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-sm mb-1" />
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {playerSearchResults(transferSearch, [league.createdBy?.id || ""]).map((p) => (
                    <button key={p.id} onClick={async () => {
                      const ok = await confirm({ message: `Transfer director role to ${p.name}? You will become a helper.` });
                      if (!ok) return;
                      await fetch(`/api/leagues/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ createdById: p.id }),
                      });
                      if (userId) await addHelper(userId);
                      setShowTransferPicker(false);
                      fetchLeague();
                    }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-left">
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                      <span className="text-sm">{p.name}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowTransferPicker(false)} className="text-xs text-muted mt-1">Cancel</button>
              </div>
            )}
          </div>

          {/* Deputy */}
          <div>
            <label className="block text-xs text-muted mb-1">Deputy Director</label>
            {deputyPlayer && !showDeputyPicker ? (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <PlayerAvatar name={deputyPlayer.name} photoUrl={deputyPlayer.photoUrl} size="xs" />
                <span className="text-sm font-medium flex-1">{deputyPlayer.name}</span>
                <button onClick={() => { setEditDeputyId(""); setDirty(true); }} className="text-xs text-danger px-1">✕</button>
                <button onClick={() => { setShowDeputyPicker(true); setDeputySearch(""); fetchPlayers(); }}
                  className="text-xs text-muted hover:text-foreground">Change</button>
              </div>
            ) : showDeputyPicker ? (
              <div>
                <input type="text" value={deputySearch} onChange={(e) => setDeputySearch(e.target.value)}
                  placeholder="Search deputy..." autoFocus
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-sm mb-1" />
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {playerSearchResults(deputySearch, [league.createdBy?.id || ""]).map((p) => (
                    <button key={p.id} onClick={() => { setEditDeputyId(p.id); setShowDeputyPicker(false); setDirty(true); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-left">
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                      <span className="text-sm">{p.name}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowDeputyPicker(false)} className="text-xs text-muted mt-1">Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setShowDeputyPicker(true); setDeputySearch(""); fetchPlayers(); }}
                className="w-full text-left border border-dashed border-border rounded-lg px-3 py-2 text-sm text-muted hover:bg-gray-50">
                + Select deputy director
              </button>
            )}
          </div>

          {editFooter(saveInfo, "")}
        </div>

        {/* Helpers */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Helpers ({league.helpers?.length || 0})</h3>
          <div className="space-y-1">
            {league.helpers?.map((h) => (
              <div key={h.id} className="flex items-center gap-2 py-1">
                <PlayerAvatar name={h.player.name} photoUrl={h.player.photoUrl} size="xs" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{h.player.name}</div>
                  {h.player.email && <div className="text-[10px] text-muted truncate">{h.player.email}</div>}
                </div>
                <button onClick={() => removeHelper(h.playerId)} className="text-xs text-danger px-1 hover:underline">✕</button>
              </div>
            ))}
            {(!league.helpers || league.helpers.length === 0) && <p className="text-xs text-muted">No helpers yet</p>}
          </div>
          {showAddHelper ? (
            <div>
              <input type="text" value={helperSearch} onChange={(e) => setHelperSearch(e.target.value)}
                placeholder="Search player..." autoFocus
                className="w-full border border-border rounded-lg px-2 py-1.5 text-sm mb-1" />
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {playerSearchResults(helperSearch, [league.createdBy?.id || "", ...(league.helpers?.map((h) => h.playerId) || [])]).map((p) => (
                  <button key={p.id} onClick={() => addHelper(p.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-left">
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                    <span className="text-sm">{p.name}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAddHelper(false)} className="text-xs text-muted mt-1">Done</button>
            </div>
          ) : (
            <button onClick={() => { setShowAddHelper(true); setHelperSearch(""); fetchPlayers(); }}
              className="text-xs text-primary font-medium">+ Add Helper</button>
          )}
        </div>
      </div>
    );
  }

  if (editSection === "requests") {
    const handleAction = async (req: RequestDetail, action: "accept" | "decline", teamId?: string) => {
      if (action === "decline") {
        const ok = await confirm({
          title: "Decline sign-up?",
          message: `${req.player.name} will be notified that their sign-up was declined. They can sign up again if registration is still open.`,
          confirmText: "Decline",
          danger: true,
        });
        if (!ok) return;
      }
      setRequestActionId(req.id);
      const r = await fetch(`/api/leagues/${id}/participation-requests/${req.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, teamId }),
      });
      setRequestActionId(null);
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed"); return; }
      await Promise.all([fetchParticipationRequests(), fetchLeague()]);
    };

    const captainTeamIds = new Set(
      league.teams.filter((t) => t.captain?.id === userId || t.viceCaptain?.id === userId).map((t) => t.id),
    );
    const canActOnRequest = (req: RequestDetail): { accept: boolean; decline: boolean } => {
      if (isAppAdmin || isDirector || isDeputy || isHelper) return { accept: true, decline: true };
      // Captain of the preferred team can act
      if (req.preferredTeamId && captainTeamIds.has(req.preferredTeamId)) return { accept: true, decline: true };
      // Free agent: any captain can claim
      if (!req.preferredTeamId && captainTeamIds.size > 0) return { accept: true, decline: false };
      return { accept: false, decline: false };
    };

    const pendingReqs = requestList.filter((r) => r.status === "pending");
    // Group by preferred team (free agents in their own bucket).
    const groups: { key: string; teamName: string | null; reqs: RequestDetail[] }[] = [];
    for (const t of [...league.teams].sort((a, b) => a.name.localeCompare(b.name))) {
      const reqs = pendingReqs.filter((r) => r.preferredTeamId === t.id);
      if (reqs.length > 0) groups.push({ key: t.id, teamName: t.name, reqs });
    }
    const freeAgentReqs = pendingReqs.filter((r) => !r.preferredTeamId);
    if (freeAgentReqs.length > 0) groups.push({ key: "__free", teamName: null, reqs: freeAgentReqs });

    const renderRequestRow = (req: RequestDetail) => {
      const { accept: canAccept, decline: canDecline } = canActOnRequest(req);
      const pending = requestActionId === req.id;
      const prefs = req.preferences || {};
      return (
        <div key={req.id} className="border border-border rounded-lg p-3 flex items-start gap-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <PlayerAvatar name={req.player.name} photoUrl={req.player.photoUrl} size="sm" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-sm font-medium truncate">
                {req.player.name}
                {req.player.gender && <span className="ml-1 text-muted">{req.player.gender === "F" ? "♀" : "♂"}</span>}
                {req.player.rating != null && <span className="ml-1 text-[11px] text-muted">· {Math.round(req.player.rating)}</span>}
              </div>
              {Object.keys(prefs).length > 0 && (
                <div className="space-y-0.5">
                  {league.categories.map((c) => {
                    const p = prefs[c.id];
                    // Hide "no" — captain only needs to see what the player wants.
                    if (!p || p.level === "no") return null;
                    const isPrefer = p.level === "prefer";
                    return (
                      <div key={c.id} className={`text-[11px] ${isPrefer ? "text-emerald-700 font-bold" : "text-foreground"}`}>
                        <span>{c.name}</span>
                        {p.note && <span className="text-muted font-normal italic"> ({p.note})</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col justify-between items-end self-stretch shrink-0 gap-1.5">
            <div className="flex flex-col items-end gap-1.5">
              {canAccept && req.preferredTeamId && (
                <button onClick={() => handleAction(req, "accept", req.preferredTeamId!)} disabled={pending}
                  className="text-xs bg-action text-white px-3 py-1 rounded-lg font-medium disabled:opacity-50">
                  Accept
                </button>
              )}
              {canAccept && !req.preferredTeamId && (
                <select
                  onChange={(e) => { if (e.target.value) handleAction(req, "accept", e.target.value); }}
                  defaultValue=""
                  disabled={pending}
                  className="text-xs border border-action text-action rounded-lg px-2 py-1 disabled:opacity-50"
                >
                  <option value="">Accept to…</option>
                  {[...league.teams].sort((a, b) => a.name.localeCompare(b.name))
                    .filter((t) => isAppAdmin || isDirector || isDeputy || isHelper || captainTeamIds.has(t.id))
                    .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
            {canDecline && (
              <button onClick={() => handleAction(req, "decline")} disabled={pending}
                className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50">
                Decline
              </button>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-2">
        {editBackLink("")}
        {requestsLoading && (
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs text-muted">Loading…</p>
          </div>
        )}
        {!requestsLoading && groups.length === 0 && (
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold">Participation requests</h3>
            <p className="text-xs text-muted mt-1">No pending requests</p>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="bg-card rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold">
              Participation requests · {g.teamName ?? "Free agents (no team picked)"}
            </h3>
            {g.reqs.map((req) => renderRequestRow(req))}
          </div>
        ))}
      </div>
    );
  }

  if (editSection === "addPlayer" && addPlayerTeam) {
    const team = addPlayerTeam;
    const teamClubId = team.clubId || team.club?.id;
    const onTeamIds = new Set(team.players.map((tp) => tp.playerId));
    // Players already on ANY team in this league — the API rejects duplicates,
    // so exclude them from the available list across both filter modes.
    const onAnyTeamIds = new Set(
      league.teams.flatMap((t) => t.players.map((tp) => tp.playerId))
    );
    const allClubMembers = teamClubId ? (clubMembersCache[teamClubId] || []) : [];
    const source = addPlayerFilter === "club" ? allClubMembers : allPlayers;
    const search = addPlayerSearch.toLowerCase();
    const results = source
      .filter((p) => !onTeamIds.has(p.id) && !onAnyTeamIds.has(p.id) && !addedThisSession.has(p.id) && p.name.toLowerCase().includes(search))
      .filter((p) => addPlayerGender === "all" || p.gender === addPlayerGender)
      .slice(0, 100);

    return (
      <div className="space-y-2">
        <div className="sticky top-0 z-30 bg-background -mx-4 px-4 py-2 shadow-sm">
          <button onClick={closeAddPlayer} className="text-sm text-action font-medium">
            ← {team.name} <span className="text-xs text-muted font-normal">({league.name})</span>
          </button>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Add Player to {team.name}</h3>
          {teamClubId && (
            <div className="flex gap-1">
              <button onClick={() => setAddPlayerFilter("club")}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${addPlayerFilter === "club" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}>
                {team.club?.name || "Club"} members
              </button>
              <button onClick={() => setAddPlayerFilter("all")}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${addPlayerFilter === "all" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}>
                All players
              </button>
            </div>
          )}
          <div className="flex gap-1">
            <button onClick={() => setAddPlayerGender("all")}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${addPlayerGender === "all" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}>
              All
            </button>
            <button onClick={() => setAddPlayerGender("M")}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${addPlayerGender === "M" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}>
              <span className={addPlayerGender === "M" ? "text-white" : "text-blue-500"}>♂</span> Men
            </button>
            <button onClick={() => setAddPlayerGender("F")}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${addPlayerGender === "F" ? "bg-black text-white" : "bg-gray-100 text-muted"}`}>
              <span className={addPlayerGender === "F" ? "text-white" : "text-pink-500"}>♀</span> Women
            </button>
          </div>
          <input type="text" value={addPlayerSearch} onChange={(e) => setAddPlayerSearch(e.target.value)}
            placeholder="Search by name..." autoFocus
            className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          <div className="text-[11px] text-muted">{results.length} available {addedThisSession.size > 0 && `· ${addedThisSession.size} added`}</div>
          {results.length === 0 ? (
            <p className="text-xs text-muted text-center py-6">
              {addPlayerFilter === "club" && allClubMembers.length === 0 ? "No club members found" : "No players match"}
            </p>
          ) : (
            <div className="space-y-0.5">
              {results.map((p) => {
                const flashing = flashSelectedId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={flashing}
                    onClick={async () => {
                      setFlashSelectedId(p.id);
                      const ok = await addPlayerToTeam(team.id, p.id);
                      if (!ok) {
                        // API failed (alert already shown) — clear flash, leave player in list
                        setFlashSelectedId((cur) => (cur === p.id ? null : cur));
                        return;
                      }
                      // refresh team in modal so the just-added player disappears from results
                      const updated = await fetch(`/api/leagues/${id}`).then((r) => r.json()).catch(() => null);
                      if (updated) {
                        setLeague(updated);
                        const fresh = updated.teams.find((t: LeagueTeam) => t.id === team.id);
                        if (fresh) setAddPlayerTeam(fresh);
                      }
                      setTimeout(() => {
                        setAddedThisSession((s) => { const n = new Set(s); n.add(p.id); return n; });
                        setFlashSelectedId((cur) => (cur === p.id ? null : cur));
                      }, 800);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                      flashing ? "bg-emerald-50" : "hover:bg-gray-50 active:bg-gray-100"
                    }`}
                  >
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      {p.email && <div className="text-[10px] text-muted truncate">{p.email}</div>}
                    </div>
                    {p.gender && (
                      <span className={`text-xs ${p.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>
                        {p.gender === "F" ? "♀" : "♂"}
                      </span>
                    )}
                    {flashing ? (
                      <span className="text-xs font-semibold text-emerald-600">✓ Selected</span>
                    ) : (
                      <span className="text-xs text-muted">{p.rating?.toFixed(0)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/leagues" className="text-sm text-action">&larr; Leagues</Link>
      {/* Header */}
      <div onClick={() => { if (canEdit) startEditInfo(); }}
        className={canEdit ? "active:opacity-70 cursor-pointer" : ""}>
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold">{league.name}</h2>
            <span className="text-sm text-muted">Season {league.season || "—"}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              league.status === "active" ? "bg-green-100 text-green-700" : league.status === "complete" ? "bg-gray-100 text-muted" : league.status === "registration" ? "bg-amber-100 text-amber-700" : league.status === "forming" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
            }`}>{league.status === "forming" ? "registration closed" : league.status === "registration" ? "registration open" : league.status}</span>
            {canEdit && (
              <span className="text-muted">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </span>
            )}
          </div>
        </div>
        {league.description && <p className="text-sm text-muted mt-1">{league.description}</p>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {(["overview", "teams", "standings", "rounds", "matches"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              if (t === "teams" && tab !== "teams") {
                // Default: collapse all teams when entering the tab
                setCollapsedTeams(new Set(league.teams.map((tm) => tm.id)));
              }
              setTab(t);
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-all ${
              tab === t ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}>{t}</button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === "overview" && (
        <div className="space-y-3">
          {/* Sign-up CTA — visible during registration. Three states:
              not signed up, pending request, or accepted (on team). */}
          {(() => {
            if (league.status !== "registration") return null;
            if (!userId) return null;
            const onTeam = allTeamPlayerIds.has(userId);
            const myReq = (league.participationRequests || []).find((r) => r.playerId === userId);
            // If user is on a team, we expect an "accepted" request — find it for the cancel action.
            const myAcceptedReq = onTeam ? (league.participationRequests || []).find((r) => r.playerId === userId && r.status === "accepted") : null;
            const myTeam = myReq?.preferredTeamId ? league.teams.find((t) => t.id === myReq.preferredTeamId) : null;
            const myCurrentTeam = onTeam ? league.teams.find((t) => t.players.some((p) => p.playerId === userId)) : null;

            if (!myReq && !onTeam) {
              return (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="text-sm text-emerald-900 flex-1 min-w-0">
                    Registration is open. Sign up to play in this league.
                  </div>
                  <Link href={`/leagues/${id}/sign-up`}
                    className="bg-action text-white text-sm font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap">
                    Sign up
                  </Link>
                </div>
              );
            }

            const handleCancel = async (reqId: string, accepted: boolean) => {
              const ok = await confirm({
                title: accepted ? "Leave team & cancel registration?" : "Cancel registration?",
                message: accepted
                  ? `You'll be removed from ${myCurrentTeam?.name || "your team"}. The team captain will be notified.`
                  : "Your sign-up will be withdrawn. You can re-sign up later if registration is still open.",
                confirmText: accepted ? "Leave team" : "Cancel sign-up",
                danger: true,
              });
              if (!ok) return;
              const r = await fetch(`/api/leagues/${id}/participation-requests/${reqId}`, { method: "DELETE" });
              if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                alert(d.error || "Failed to cancel");
                return;
              }
              fetchLeague();
            };

            // On a team (accepted)
            if (onTeam) {
              return (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="text-sm text-emerald-900 flex-1 min-w-0">
                    <strong>You&apos;re on team {myCurrentTeam?.name || "—"}.</strong>
                  </div>
                  {myAcceptedReq && (
                    <button onClick={() => handleCancel(myAcceptedReq.id, true)}
                      className="text-sm text-rose-700 font-medium px-3 py-1.5 rounded-lg whitespace-nowrap hover:bg-rose-100">
                      Leave team
                    </button>
                  )}
                </div>
              );
            }

            // Pending request
            const myPrefs = myReq?.preferences || {};
            const myPrefRows = league.categories
              .map((c) => ({ cat: c, p: myPrefs[c.id] }))
              .filter(({ p }) => p && p.level !== "no");
            return (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start justify-between gap-2">
                <div className="text-sm text-emerald-900 flex-1 min-w-0">
                  <div>
                    <strong>
                      {myTeam
                        ? <>You&apos;re signed up for team {myTeam.name}.</>
                        : <>You&apos;re signed up as a free agent.</>}
                    </strong>
                  </div>
                  <div>Waiting for approval</div>
                  {myPrefRows.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {myPrefRows.map(({ cat, p }) => {
                        const isPrefer = p!.level === "prefer";
                        return (
                          <div key={cat.id} className={`text-[11px] ${isPrefer ? "text-emerald-700 font-bold" : "text-foreground"}`}>
                            <span>{cat.name}</span>
                            {p!.note && <span className="text-muted font-normal italic"> ({p!.note})</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => myReq && handleCancel(myReq.id, false)}
                    className="text-sm text-rose-700 font-medium px-2 py-1.5 rounded-lg hover:bg-rose-100">
                    Cancel
                  </button>
                  <Link href={`/leagues/${id}/sign-up`}
                    className="bg-action text-white text-sm font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap">
                    Edit
                  </Link>
                </div>
              </div>
            );
          })()}
          {/* Create Grande Final */}
          {canEdit && league.status === "active" && (
            <button
              onClick={async () => {
                const ok = await confirm({ title: "Create Grande Final", message: "Create Grande Final event from current standings? This will create a new playoff round with bracket seeding.", confirmText: "Create" });
                if (!ok) return;
                const r = await fetch(`/api/leagues/${id}/playoff`, { method: "POST" });
                if (r.ok) {
                  const data = await r.json();
                  router.push(`/events/${data.eventId}`);
                } else {
                  const err = await r.json().catch(() => ({ error: "Failed" }));
                  alert(err.error || "Failed to create playoff");
                }
              }}
              className="w-full bg-action-dark text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
            >
              🏆 Create Grande Final
            </button>
          )}

          {/* League Format card */}
          <div onClick={() => { if (canEdit) { startEditInfo(); setEditSection("format"); } }}
            className={`bg-card rounded-xl border border-border p-4 space-y-2 ${canEdit ? "active:opacity-70 cursor-pointer" : ""}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">League Format</h3>
              {canEdit && <span className="text-muted"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></span>}
            </div>
            <div className="text-sm space-y-1">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div><span className="text-xs text-muted">Max roster: </span><span className="font-medium">{league.config?.maxRoster ?? "—"}</span></div>
                <div><span className="text-xs text-muted">Max pts / match day: </span><span className="font-medium">{league.config?.maxPointsPerMatchDay ?? "—"}</span></div>
                <div><span className="text-xs text-muted">Max league matches / event: </span><span className="font-medium">{league.config?.maxMatchesPerEvent ?? "—"}</span></div>
                <div><span className="text-xs text-muted">Min match days for playoff: </span><span className="font-medium">{league.config?.minMatchDaysForPlayoff ?? 2}</span></div>
                <div className="col-span-2"><span className="text-xs text-muted">Cross-category play: </span><span className="font-medium">{league.config?.allowCrossCategoryPlay === false ? "Not allowed" : "Allowed"}</span></div>
              </div>
            </div>
          </div>

          {/* Management card */}
          <div onClick={() => { if (canEdit) { fetchPlayers(); startEditInfo(); setEditSection("management"); } }}
            className={`bg-card rounded-xl border border-border p-4 space-y-2 ${canEdit ? "active:opacity-70 cursor-pointer" : ""}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Management</h3>
              {canEdit && <span className="text-muted"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></span>}
            </div>
            <div>
              <p className="text-sm">
                <span className="text-xs text-muted">Director </span><span className="font-medium">{league.createdBy?.name || "—"}</span>
                {league.deputy && <><span className="text-xs text-muted"> · Deputy </span><span className="font-medium">{league.deputy.name}</span></>}
              </p>
              {league.helpers?.length > 0 && (
                <p className="text-sm mt-0.5">
                  <span className="text-xs text-muted">Helpers </span>
                  {league.helpers.map((h, i) => (
                    <span key={h.id}><span className="font-medium">{h.player.name}</span>{i < league.helpers.length - 1 && ", "}</span>
                  ))}
                </p>
              )}
            </div>
          </div>

          {/* Categories card */}
          <div onClick={() => { if (canEdit) startEditCategories(); }}
            className={`bg-card rounded-xl border border-border p-4 space-y-2 ${canEdit ? "active:opacity-70 cursor-pointer" : ""}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Categories ({league.categories.length})</h3>
              {canEdit && <span className="text-muted"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></span>}
            </div>
            <div className="space-y-1">
              {league.categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="font-medium flex-1">{cat.name}</span>
                  <span className="text-xs text-muted">{cat.format} · {cat.gender}{cat.maxPerEvent != null ? ` · max ${cat.maxPerEvent}` : ""}</span>
                  {cat.status === "draft" && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Draft</span>}
                </div>
              ))}
              {league.categories.length === 0 && <p className="text-xs text-muted">No categories yet</p>}
            </div>
          </div>

          {/* Rounds preview */}
          <div onClick={() => setTab("rounds")}
            className="bg-card rounded-xl border border-border p-4 space-y-2 active:opacity-70 cursor-pointer">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Rounds ({league.rounds.length})</h3>
              <span className="text-xs text-muted">View all ›</span>
            </div>
            {league.rounds.length > 0 ? (
              <div className="space-y-1">
                {league.rounds.slice(-3).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="font-medium flex-1">{r.name || `Round ${r.roundNumber}`}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      r.status === "completed" ? "bg-green-100 text-green-700" : r.status === "in_progress" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-muted"
                    }`}>{r.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">No rounds yet</p>
            )}
          </div>

          {/* Documents */}
          {(league.documents?.length || 0) > 0 && (
            <div className="bg-card rounded-xl border border-border p-4 space-y-1.5">
              <h3 className="text-sm font-semibold mb-1">Documents</h3>
              {league.documents!.map((d) => {
                const isImg = d.mimeType.startsWith("image/");
                return (
                  <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:underline">
                    <span>{isImg ? "🖼️" : "📄"}</span>
                    <span className="truncate font-medium text-action flex-1">{d.name}</span>
                    <span className="text-[10px] text-muted shrink-0">{Math.round(d.sizeBytes / 1024)} KB</span>
                  </a>
                );
              })}
            </div>
          )}

          {canEdit && (
            <button onClick={async () => {
              const ok = await confirm({ title: "Delete league", message: "This will permanently delete the league and all its data. This cannot be undone!", danger: true, confirmText: "Delete" });
              if (!ok) return;
              await fetch(`/api/leagues/${id}`, { method: "DELETE" });
              router.push("/leagues");
            }} className="w-full py-2.5 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50">
              Delete League
            </button>
          )}
        </div>
      )}

      {/* ── Standings Tab ── */}
      {tab === "standings" && standings && (
        <div className="space-y-4">
          {/* General standings */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">General Standings</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-muted uppercase border-b border-border">
                  <th className="text-left px-3 py-1">#</th>
                  <th className="text-left px-2 py-1">Team</th>
                  <th className="text-center px-1 py-1">P</th>
                  <th className="text-center px-1 py-1">W</th>
                  <th className="text-center px-1 py-1">L</th>
                  <th className="text-center px-1 py-1">D</th>
                  <th className="text-center px-1 py-1">CW</th>
                  <th className="text-center px-1 py-1">PD</th>
                  <th className="text-center px-2 py-1 font-bold">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.general.map((s, i) => (
                  <tr key={s.teamId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-bold text-muted">{i + 1}</td>
                    <td className="px-2 py-2 font-medium">{s.teamName}</td>
                    <td className="text-center px-1 py-2 text-muted">{s.played}</td>
                    <td className="text-center px-1 py-2 text-green-600">{s.won}</td>
                    <td className="text-center px-1 py-2 text-red-500">{s.lost}</td>
                    <td className="text-center px-1 py-2 text-muted">{s.drawn}</td>
                    <td className="text-center px-1 py-2 text-muted text-[10px]">{s.totalCategoryWins}</td>
                    <td className="text-center px-1 py-2 text-muted text-[10px]">{s.pointDifference > 0 ? `+${s.pointDifference}` : s.pointDifference}</td>
                    <td className="text-center px-2 py-2 font-bold">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Playoff eligibility */}
          {canEdit && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <button onClick={() => { if (!eligibility) fetchEligibility(); else setEligibility(null); }}
                className="w-full text-left text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium hover:bg-gray-50">
                {eligibility ? "▾" : "▸"} Playoff Eligibility (min {(league.config as Record<string, number> | null)?.minMatchDaysForPlayoff ?? 2} match days)
              </button>
              {eligibility && eligibility.teams.map((team) => (
                <div key={team.teamId} className="px-3 py-2 border-t border-border">
                  <p className="text-xs font-semibold mb-1">{team.teamName}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {team.players.map((p) => (
                      <span key={p.playerId} className={`text-[10px] ${p.eligible ? "text-green-600" : "text-red-400"}`}>
                        {p.eligible ? "✓" : "✗"} {p.name} ({p.matchDaysPlayed})
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Category standings */}
          {standings.categories.map((cat) => (
            <div key={cat.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">{cat.name}</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] text-muted uppercase border-b border-border">
                    <th className="text-left px-3 py-1">#</th>
                    <th className="text-left px-2 py-1">Team</th>
                    <th className="text-center px-2 py-1">W</th>
                    <th className="text-center px-2 py-1">L</th>
                  </tr>
                </thead>
                <tbody>
                  {(standings.categoryStandings[cat.id] || []).map((s, i) => (
                    <tr key={s.teamId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-bold text-muted">{i + 1}</td>
                      <td className="px-2 py-2 font-medium">{s.teamName}</td>
                      <td className="text-center px-2 py-2 text-green-600">{s.wins}</td>
                      <td className="text-center px-2 py-2 text-red-500">{s.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── Rounds Tab ── */}
      {tab === "rounds" && (
        <div className="space-y-3">
          {league.rounds.map((round) => (
            <div key={round.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-border flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold">{round.name || `Round ${round.roundNumber}`}</span>
                  {(round.startDate || round.endDate) && (
                    <span className="text-[11px] text-muted ml-2">
                      {round.startDate ? new Date(round.startDate).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
                      {round.endDate ? ` → ${new Date(round.endDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  round.status === "completed" ? "bg-green-100 text-green-700" : round.status === "in_progress" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-muted"
                }`}>{round.status}</span>
                {canEdit && editingRoundId !== round.id && (
                  <>
                    <button onClick={() => setEditingRoundId(round.id)}
                      aria-label="Edit round"
                      className="text-xs text-muted hover:text-foreground rounded px-1.5 py-0.5">
                      <svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button onClick={() => deleteRound(round.id, round.name || `Round ${round.roundNumber}`)}
                      aria-label="Delete round"
                      className="text-xs text-danger hover:bg-red-50 rounded px-1.5 py-0.5">✕</button>
                  </>
                )}
              </div>
              {editingRoundId === round.id && (
                <div className="p-3">
                  <RoundForm
                    mode="edit"
                    initial={{
                      roundNumber: round.roundNumber,
                      name: round.name ?? "",
                      startDate: round.startDate ? round.startDate.slice(0, 10) : "",
                      endDate: round.endDate ? round.endDate.slice(0, 10) : "",
                      configOverride: (round.configOverride as RoundFormValues["configOverride"]) ?? null,
                      categoriesOverride: (round.categoriesOverride as RoundFormValues["categoriesOverride"]) ?? null,
                    }}
                    leagueCategories={league.categories}
                    leagueConfig={league.config}
                    onSubmit={(v) => saveRound("edit", v, round.id)}
                    onCancel={() => setEditingRoundId(null)}
                  />
                </div>
              )}
              {editingRoundId !== round.id && round.events.map((ev) => (
                <div key={ev.id} className="px-3 py-3 border-b border-border last:border-0">
                  {/* Teams */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {ev.leagueTeams.map((t, i) => (
                        <span key={t.teamId} className="text-sm font-medium">
                          {i > 0 && <span className="text-muted mx-1">vs</span>}
                          {t.team.name}
                          {t.teamId === ev.hostTeamId && <span className="text-[9px] text-muted ml-1">(H)</span>}
                        </span>
                      ))}
                    </div>
                    {ev.date && <span className="text-xs text-muted">{new Date(ev.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                  </div>

                  {/* Team points summary */}
                  <div className="flex gap-2 mb-2">
                    {ev.leagueTeams.map((t) => (
                      <span key={t.teamId} className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                        {t.team.name}: <span className="font-bold">{t.points}</span> pts
                      </span>
                    ))}
                  </div>

                  {/* Lineup status / link per team */}
                  {(() => {
                    const lineups = ev.leagueLineups || [];
                    const fullTeams = ev.leagueTeams.map((t) => league.teams.find((lt) => lt.id === t.teamId)).filter((t): t is NonNullable<typeof t> => !!t);
                    const visible = fullTeams.filter((t) => isAppAdmin || isDirector || isDeputy || isHelper || t.captain?.id === userId || t.viceCaptain?.id === userId);
                    if (visible.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {visible.map((t) => {
                          const lu = lineups.find((l) => l.teamId === t.id);
                          const status = lu?.status || "draft";
                          const color = status === "draft" ? "bg-blue-100 text-blue-700" : status === "submitted" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";
                          return (
                            <Link key={t.id} href={`/leagues/${id}/events/${ev.id}/lineup/${t.id}`}
                              className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 border border-border flex items-center gap-1 hover:bg-gray-100">
                              <span>{t.name}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${color}`}>{status}</span>
                            </Link>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Games */}
                  {ev.leagueGames.length > 0 && (
                    <div className="space-y-1">
                      {ev.leagueGames.map((game) => (
                        <div key={game.id} className={`flex items-center gap-2 text-xs ${!game.isPrincipal ? "opacity-60 pl-2 border-l-2 border-dashed border-gray-300" : ""}`}>
                          <span className="text-muted w-24 truncate">{game.category.name}{!game.isPrincipal && <span className="text-[8px] ml-1 text-amber-600">(friendly)</span>}</span>
                          <span className={`flex-1 font-medium ${game.winner?.id === game.team1.id ? "text-green-600" : ""}`}>{game.team1.name}</span>
                          <span className="text-muted">vs</span>
                          <span className={`flex-1 font-medium text-right ${game.winner?.id === game.team2.id ? "text-green-600" : ""}`}>{game.team2.name}</span>
                          {/* Principal/Friendly toggle (canEdit only, blocked once winner set) */}
                          {canEdit && !game.winner && (
                            <button
                              onClick={async () => {
                                const r = await fetch(`/api/leagues/${id}/events/${ev.id}/games/${game.id}`, {
                                  method: "PATCH", headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ isPrincipal: !game.isPrincipal }),
                                });
                                if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed"); return; }
                                fetchLeague();
                              }}
                              title={game.isPrincipal ? "Make friendly" : "Make principal"}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-foreground"
                            >{game.isPrincipal ? "→ friendly" : "→ principal"}</button>
                          )}
                          {/* Winner selector */}
                          <select value={game.winner?.id || ""} onChange={(e) => setGameWinner(ev.id, game.id, e.target.value || null)}
                            className="text-[10px] border border-border rounded px-1 py-0.5 w-20">
                            <option value="">TBD</option>
                            <option value={game.team1.id}>{game.team1.name}</option>
                            <option value={game.team2.id}>{game.team2.name}</option>
                          </select>
                        </div>
                      ))}
                      {/* Add extra game */}
                      {ev.leagueTeams.length === 2 && canEdit && (
                        <button
                          onClick={async () => {
                            const catId = prompt("Category ID for extra game (copy from existing game):");
                            if (!catId) return;
                            const cat = league.categories.find((c: LeagueCategory) => c.id === catId || c.name.toLowerCase().includes(catId.toLowerCase()));
                            if (!cat) { alert("Category not found"); return; }
                            await fetch(`/api/leagues/${id}/events/${ev.id}/games`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "create_extra", categoryId: cat.id, team1Id: ev.leagueTeams[0].teamId, team2Id: ev.leagueTeams[1].teamId }),
                            });
                            fetchLeague();
                          }}
                          className="text-[10px] text-action font-medium hover:underline mt-1"
                        >
                          + Add extra game
                        </button>
                      )}
                    </div>
                  )}

                  {/* Event link */}
                  <div className="mt-2">
                    <Link href={`/events/${ev.id}`} className="text-xs text-action font-medium hover:underline">
                      📅 {ev.name} ({ev.status})
                    </Link>
                  </div>
                </div>
              ))}
              {editingRoundId !== round.id && canEdit && league.teams.length >= 2 && (
                <AddRoundEventForm
                  teams={league.teams.map((t) => ({ id: t.id, name: t.name }))}
                  defaultDate={round.startDate}
                  onAdd={(t1, t2, host, date) => addEventToRound(round.id, t1, t2, host, date)}
                />
              )}
            </div>
          ))}

          {/* Add round */}
          {!showAddRound ? (
            <button onClick={() => setShowAddRound(true)}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5">
              + Add Round
            </button>
          ) : (
            <RoundForm
              mode="add"
              initial={{
                roundNumber: newRoundNumber,
                name: "",
                startDate: "",
                endDate: "",
                configOverride: null,
                categoriesOverride: null,
              }}
              leagueCategories={league.categories}
              leagueConfig={league.config}
              onSubmit={(v) => saveRound("add", v)}
              onCancel={() => setShowAddRound(false)}
            />
          )}
        </div>
      )}

      {/* ── Matches Tab ── */}
      {tab === "matches" && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex gap-1.5 flex-wrap">
            <select value={matchRoundFilter} onChange={(e) => setMatchRoundFilter(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">All rounds</option>
              {league.rounds.map((r) => <option key={r.id} value={String(r.roundNumber)}>{r.name || `Round ${r.roundNumber}`}</option>)}
            </select>
            <select value={matchTeamFilter} onChange={(e) => setMatchTeamFilter(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">All teams</option>
              {league.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={matchStatusFilter} onChange={(e) => setMatchStatusFilter(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">All status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {!matchesLoaded ? (
            <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-action border-t-transparent rounded-full animate-spin" /></div>
          ) : (() => {
            const filtered = leagueMatches.filter((m) => {
              if (matchRoundFilter && String(m.roundNumber) !== matchRoundFilter) return false;
              if (matchTeamFilter && !m.teams.some((t) => t.id === matchTeamFilter)) return false;
              if (matchStatusFilter && m.status !== matchStatusFilter) return false;
              return true;
            });

            if (filtered.length === 0) return <p className="text-center py-8 text-muted text-sm">No matches found</p>;

            // Group by round
            const byRound = new Map<number, typeof filtered>();
            for (const m of filtered) {
              const arr = byRound.get(m.roundNumber) || [];
              arr.push(m);
              byRound.set(m.roundNumber, arr);
            }

            return [...byRound.entries()].sort((a, b) => b[0] - a[0]).map(([roundNum, matches]) => (
              <div key={roundNum}>
                <div className="text-xs font-bold text-muted uppercase tracking-wider mb-2">
                  {matches[0].roundName}
                </div>
                <div className="space-y-2">
                  {matches.map((m) => {
                    const team1 = m.players.filter((mp) => mp.team === 1);
                    const team2 = m.players.filter((mp) => mp.team === 2);
                    const score1 = team1[0]?.score ?? 0;
                    const score2 = team2[0]?.score ?? 0;
                    const isCompleted = m.status === "completed";
                    const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;

                    return (
                      <Link key={m.id} href={`/events/${m.event.id}`}
                        className={`block bg-white rounded-xl border border-l-4 overflow-hidden active:bg-gray-50 ${
                          isCompleted ? (myTeam ? (myTeam === 1 ? score1 > score2 : score2 > score1) ? "border-green-500" : "border-red-400" : "border-gray-300") : "border-action"
                        }`}>
                        <div className="px-2.5 py-1.5 bg-gray-50 border-b border-border flex items-center gap-1.5">
                          <span className="text-[10px] text-muted flex-1">
                            {m.teams.map((t) => t.name).join(" vs ")} · Court {m.courtNum}
                          </span>
                          {isCompleted && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-muted">Done</span>}
                          {!isCompleted && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 capitalize">{m.status}</span>}
                        </div>
                        <div className="px-2 py-1.5">
                          {[{ players: team1, score: score1 }, { players: team2, score: score2 }].map((side, si) => {
                            const won = isCompleted && side.score > (si === 0 ? score2 : score1);
                            const isMyTeam = myTeam === (si + 1);
                            return (
                              <div key={si}>
                              {si === 1 && <div className="h-px bg-border mx-2 my-0.5" />}
                              <div className={`flex items-center gap-1 p-1.5 rounded-lg ${isMyTeam && isCompleted ? (won ? "bg-green-50" : "bg-red-50") : ""}`}>
                                <div className="flex-1 min-w-0 space-y-0.5">
                                  {side.players.map((mp) => (
                                    <div key={mp.id} className="flex items-center gap-1.5">
                                      <PlayerAvatar name={mp.player.name} photoUrl={mp.player.photoUrl} size="xs" />
                                      <span className={`text-sm truncate ${mp.playerId === userId ? "font-bold" : "font-medium"} ${isMyTeam && isCompleted ? (won ? "text-green-700" : "text-red-600") : ""}`}>{mp.player.name}</span>
                                    </div>
                                  ))}
                                </div>
                                <span className={`text-2xl font-bold tabular-nums min-w-[2.5rem] text-center ${isCompleted ? (won ? "text-green-600" : "text-red-500") : "text-gray-400"}`}>
                                  {isCompleted ? side.score : "-"}
                                </span>
                              </div>
                              </div>
                            );
                          })}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ── Teams Tab ── */}
      {tab === "teams" && (
        <div className="space-y-3">
          {/* Pending sign-ups — one card per team the viewer manages, plus free-agents card. */}
          {(() => {
            const captainTeams = league.teams.filter((t) => t.captain?.id === userId || t.viceCaptain?.id === userId);
            const isOrganizer = isAppAdmin || isDirector || isDeputy || isHelper;
            if (!isOrganizer && captainTeams.length === 0) return null;

            const reqs = league.participationRequests || [];
            if (reqs.length === 0) return null;

            // Organizers see cards for every team with pending; captains only for their own teams.
            const teamsToShow = isOrganizer ? league.teams : captainTeams;
            const teamCards = teamsToShow
              .map((t) => ({ team: t, teamReqs: reqs.filter((r) => r.preferredTeamId === t.id) }))
              .filter(({ teamReqs }) => teamReqs.length > 0);
            const freeAgents = reqs.filter((r) => !r.preferredTeamId);

            if (teamCards.length === 0 && freeAgents.length === 0) return null;

            const renderGenderCounts = (rs: typeof reqs) => {
              const f = rs.filter((r) => r.player.gender === "F").length;
              const m = rs.filter((r) => r.player.gender === "M").length;
              if (f === 0 && m === 0) return null;
              return (
                <span className="ml-1 font-normal">
                  {f > 0 && <span className="text-pink-500">♀{f}</span>}
                  {m > 0 && <span className="text-blue-500 ml-0.5">♂{m}</span>}
                </span>
              );
            };

            return (
              <div className="space-y-2">
                {teamCards.map(({ team, teamReqs }) => (
                  <div key={team.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                    <div className="text-xs font-semibold text-amber-900">
                      ⏳ {team.name}: {teamReqs.length} pending sign-up{teamReqs.length > 1 ? "s" : ""}
                      {renderGenderCounts(teamReqs)}
                    </div>
                    <button onClick={() => setEditSection("requests")} className="text-xs text-amber-800 font-medium hover:underline">Review →</button>
                  </div>
                ))}
                {freeAgents.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                    <div className="text-xs font-semibold text-amber-900">
                      ⏳ Free agents (no team picked): {freeAgents.length} pending sign-up{freeAgents.length > 1 ? "s" : ""}
                      {renderGenderCounts(freeAgents)}
                    </div>
                    <button onClick={() => setEditSection("requests")} className="text-xs text-amber-800 font-medium hover:underline">Review →</button>
                  </div>
                )}
              </div>
            );
          })()}
          {lastRemovedName && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <span>✓</span>
              <span className="truncate">Removed <span className="font-medium">{lastRemovedName}</span></span>
            </div>
          )}
          {(isAppAdmin || isDirector || isDeputy) && league.teams.length > 0 && (league.status === "registration" || league.status === "forming") && (
            <div className="text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-2 border bg-blue-50 border-blue-200 text-blue-800">
              <span>Rosters become visible when the league goes Active.</span>
              <button onClick={async () => {
                const ok = await confirm({ title: "Activate league", message: "Move the league to Active? Team rosters become visible to everyone and roster changes are frozen.", confirmText: "Activate" });
                if (!ok) return;
                const r = await fetch(`/api/leagues/${id}`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "active" }),
                });
                if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed"); return; }
                fetchLeague();
              }} className="bg-action text-white px-3 py-1 rounded-lg font-medium text-xs whitespace-nowrap">Go Active</button>
            </div>
          )}
          {(() => {
            // A team's roster is visible to: organizers/helpers/admin always,
            // its own captain/vice always, and to everyone once the league
            // reaches "active" (or "complete"). Admin "view as user/event"
            // downgrades captaincy for testing.
            const rostersAreVisible = league.status === "active" || league.status === "complete";
            const expandableTeams = league.teams.filter((t) =>
              isAppAdmin || isDirector || isDeputy || isHelper ||
              rostersAreVisible ||
              (leaguePowersAllowed && (t.captain?.id === userId || t.viceCaptain?.id === userId)),
            );
            if (expandableTeams.length === 0) return null;
            const allCollapsed = expandableTeams.every((t) => collapsedTeams.has(t.id));
            return (
              <div className="flex justify-end">
                <button
                  onClick={() => setCollapsedTeams(allCollapsed ? new Set() : new Set(expandableTeams.map((t) => t.id)))}
                  className="text-xs text-muted hover:text-foreground flex items-center gap-1 px-2 py-1"
                  title={allCollapsed ? "Expand all" : "Collapse all"}
                >
                  <span className="text-[10px]">{allCollapsed ? "▼" : "▲"}</span>
                  {allCollapsed ? "Expand all" : "Collapse all"}
                </button>
              </div>
            );
          })()}
          {[...league.teams].sort((a, b) => a.name.localeCompare(b.name)).map((team) => {
          // Team captain/vice powers are tied to the team, not platform admin
          // status — so they apply even when an admin is viewing as "User".
          const isTeamLeader = team.captain?.id === userId || team.viceCaptain?.id === userId;
          // League status active/complete freezes all roster changes.
          const leagueRosterFrozen = league.status === "active" || league.status === "complete";
          const canAddToTeam = (isAppAdmin || isDirector || isTeamLeader) && !leagueRosterFrozen;
          const rostersAreVisible = league.status === "active" || league.status === "complete";
          const canSeeRoster = isAppAdmin || isDirector || isDeputy || isHelper ||
            rostersAreVisible || isTeamLeader;
          // Captains can edit team metadata (slogan/logo/photo). League
          // managers can additionally rename and change captain/vice/club.
          const canEditTeam = canEdit || isTeamLeader;
          return (
            <div key={team.id} className="bg-card rounded-xl border border-border overflow-hidden">
              {team.photoUrl && (
                <img src={team.photoUrl} alt="" className="w-full max-h-40 object-cover" />
              )}
              <button
                onClick={() => {
                  if (!canSeeRoster) return;
                  setCollapsedTeams((prev) => { const n = new Set(prev); if (n.has(team.id)) n.delete(team.id); else n.add(team.id); return n; });
                }}
                disabled={!canSeeRoster}
                className={`w-full px-3 py-2 bg-gray-50 border-b border-border flex items-center justify-between gap-2 text-left ${canSeeRoster ? "" : "cursor-default"}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {canSeeRoster
                    ? <span className={`transition-transform text-[10px] ${collapsedTeams.has(team.id) ? "" : "rotate-90"}`}>›</span>
                    : <span className="w-2.5" />}
                  {team.logoUrl ? <img src={team.logoUrl} alt="" className="w-7 h-7 rounded object-cover" />
                    : team.club?.logoUrl ? <img src={team.club.logoUrl} alt="" className="w-7 h-7 rounded object-cover" />
                    : <span className="text-lg">{team.club?.emoji || "🏟️"}</span>}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm truncate">{team.name}</span>
                      <span className="text-xs text-muted shrink-0">({team._count.players})</span>
                      {(() => {
                        const f = team.players.filter((tp) => tp.player.gender === "F").length;
                        const m = team.players.filter((tp) => tp.player.gender === "M").length;
                        if (f === 0 && m === 0) return null;
                        return (
                          <span className="text-[11px] shrink-0 flex items-center gap-1">
                            {f > 0 && <span className="text-pink-500">♀{f}</span>}
                            {m > 0 && <span className="text-blue-500">♂{m}</span>}
                          </span>
                        );
                      })()}
                      {(() => {
                        const teamReqs = (league.participationRequests || []).filter((r) => r.preferredTeamId === team.id);
                        if (teamReqs.length === 0) return null;
                        const pf = teamReqs.filter((r) => r.player.gender === "F").length;
                        const pm = teamReqs.filter((r) => r.player.gender === "M").length;
                        return (
                          <span className="text-[11px] shrink-0 flex items-center gap-1 text-amber-700" title="Pending sign-ups">
                            <span>⏳</span>
                            {pf > 0 && <span className="text-pink-500">♀{pf}</span>}
                            {pm > 0 && <span className="text-blue-500">♂{pm}</span>}
                            {pf === 0 && pm === 0 && <span>{teamReqs.length}</span>}
                          </span>
                        );
                      })()}
                      {(() => {
                        const myReq = (league.participationRequests || []).find(
                          (r) => r.playerId === userId && r.preferredTeamId === team.id,
                        );
                        if (!myReq) return null;
                        return (
                          <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                            ⏳ You&apos;re signed up
                          </span>
                        );
                      })()}
                    </div>
                    {team.captain && <div className="text-[10px] text-muted truncate"><span className="opacity-70">Leader:</span> <span className="text-foreground">{team.captain.name}</span></div>}
                    {team.viceCaptain && <div className="text-[10px] text-muted truncate"><span className="opacity-70">Deputy:</span> <span className="text-foreground">{team.viceCaptain.name}</span></div>}
                    {team.slogan && <div className="text-[11px] italic text-muted truncate">&ldquo;{team.slogan}&rdquo;</div>}
                  </div>
                </div>
                {(canEditTeam || canAddToTeam) && (
                  <div className="flex flex-col items-end justify-between shrink-0 self-stretch py-0.5 gap-1">
                    {canEditTeam ? (
                      <span onClick={(e) => { e.stopPropagation(); openTeamEdit(team); }} className="text-muted hover:text-foreground p-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </span>
                    ) : <span />}
                    {canAddToTeam && (
                      <span
                        onClick={(e) => { e.stopPropagation(); openAddPlayer(team); }}
                        className="text-[11px] text-primary font-medium px-2 py-0.5 mr-2 rounded hover:bg-primary/10"
                      >+ Add Player</span>
                    )}
                  </div>
                )}
              </button>
              {canSeeRoster && !collapsedTeams.has(team.id) && (
                <TeamRoster
                  team={team}
                  canEdit={canEdit}
                  removingPlayerId={removingPlayerId}
                  onRemove={(playerId, playerName) => removePlayerFromTeam(team.id, playerId, playerName)}
                />
              )}
            </div>
          );
          })}

          {canEdit && (
            <button onClick={() => openTeamEdit(null)}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5">
              + Add Team
            </button>
          )}
        </div>
      )}

    </div>
  );
}
