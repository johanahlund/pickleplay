"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { useConfirm } from "@/components/ConfirmDialog";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import Link from "next/link";
import { autoCatName as buildCatName } from "@/lib/leagueCategories";

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
interface LeagueCategory { id: string; name: string; format: string; gender: string; ageGroup: string; skillMin: number | null; skillMax: number | null; scoringFormat: string; winBy: string; status: string; sortOrder: number }
interface LeagueGame {
  id: string; categoryId: string;
  category: { id: string; name: string };
  team1: { id: string; name: string };
  team2: { id: string; name: string };
  winner?: { id: string; name: string } | null;
  matchId?: string | null;
}
interface LeagueMatchDay {
  id: string; date: string | null; status: string; hostTeamId: string | null;
  teams: { teamId: string; points: number; team: { id: string; name: string; logoUrl: string | null } }[];
  games: LeagueGame[];
  event?: { id: string; name: string; date: string; status: string } | null;
}
interface LeagueRound { id: string; roundNumber: number; name: string | null; suggestedDate: string | null; status: string; matchDays: LeagueMatchDay[] }
interface LeagueHelperEntry { id: string; playerId: string; player: { id: string; name: string; email?: string | null; photoUrl?: string | null } }
interface League {
  id: string; name: string; description: string | null; season: string | null; status: string;
  config: { maxRoster?: number; maxPointsPerMatchDay?: number } | null;
  createdBy?: { id: string; name: string } | null;
  deputy?: { id: string; name: string } | null;
  helpers: LeagueHelperEntry[];
  teams: LeagueTeam[]; rounds: LeagueRound[]; categories: LeagueCategory[];
}
interface Standing { teamId: string; teamName: string; logoUrl: string | null; played: number; won: number; lost: number; drawn: number; points: number; totalCategoryWins: number }

type Tab = "overview" | "standings" | "rounds" | "matches" | "teams";

export default function LeagueDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { viewRole } = useViewRole();
  const { confirm } = useConfirm();
  const userId = (session?.user as { id?: string })?.id;
  const userRole = (session?.user as { role?: string })?.role;

  const [league, setLeague] = useState<League | null>(null);
  const [standings, setStandings] = useState<{ general: Standing[]; categoryStandings: Record<string, { teamId: string; teamName: string; wins: number; losses: number }[]>; categories: LeagueCategory[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [editSection, setEditSection] = useState<"" | "info" | "format" | "categories" | "editCat" | "newCat" | "management" | "editTeam">("");
  const [editCatIdx, setEditCatIdx] = useState(0);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [allClubs, setAllClubs] = useState<{ id: string; name: string; emoji: string }[]>([]);

  // League matches state
  interface LeagueMatch {
    id: string; courtNum: number; round: number; status: string; createdAt: string;
    players: { id: string; playerId: string; team: number; score: number; player: { id: string; name: string; emoji: string; photoUrl?: string | null } }[];
    roundNumber: number; roundName: string; matchDayId: string;
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
  const [newRoundNumber, setNewRoundNumber] = useState(1);
  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundDate, setNewRoundDate] = useState("");
  const [newRoundTeam1, setNewRoundTeam1] = useState("");
  const [newRoundTeam2, setNewRoundTeam2] = useState("");

  // Add player to team state (modal)
  const [addPlayerTeam, setAddPlayerTeam] = useState<LeagueTeam | null>(null);
  const [addPlayerFilter, setAddPlayerFilter] = useState<"all" | "club">("all");
  const [addPlayerSearch, setAddPlayerSearch] = useState("");
  const [clubMembersCache, setClubMembersCache] = useState<Record<string, Player[]>>({});

  // Edit state
  const [dirty, setDirty] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSeason, setEditSeason] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editMaxRoster, setEditMaxRoster] = useState(14);
  const [editMaxPoints, setEditMaxPoints] = useState(3);
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
    // Set next round number
    setNewRoundNumber((data.rounds?.length || 0) + 1);
  }, [id, router]);

  const fetchStandings = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}/standings`);
    if (r.ok) setStandings(await r.json());
  }, [id]);

  useEffect(() => { fetchLeague(); fetchStandings(); }, [fetchLeague, fetchStandings]);

  const fetchLeagueMatches = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}/matches`);
    if (r.ok) { setLeagueMatches(await r.json()); setMatchesLoaded(true); }
  }, [id]);

  // Lazy-load matches when tab is selected
  useEffect(() => { if (tab === "matches" && !matchesLoaded) fetchLeagueMatches(); }, [tab, matchesLoaded, fetchLeagueMatches]);

  // Hide bottom nav when in edit views
  useEffect(() => {
    const nav = document.querySelector("nav.fixed.bottom-0");
    if (editSection) nav?.classList.add("hidden");
    else nav?.classList.remove("hidden");
    return () => { nav?.classList.remove("hidden"); };
  }, [editSection]);

  const fetchPlayers = async () => { if (allPlayers.length) return; const r = await fetch("/api/players"); if (r.ok) setAllPlayers(await r.json()); };
  const fetchClubs = async () => { if (allClubs.length) return; const r = await fetch("/api/clubs"); if (r.ok) setAllClubs(await r.json()); };

  if (loading || !league) return <div className="text-center py-12 text-muted">Loading...</div>;

  const isAppAdmin = userRole === "admin" && hasRole(viewRole, "admin");
  const isDirector = league.createdBy?.id === userId;
  const isDeputy = league.deputy?.id === userId;
  const isHelper = league.helpers?.some((h) => h.playerId === userId);
  const canEdit = isAppAdmin || isDirector || isDeputy || isHelper;

  const startEditInfo = () => {
    setEditName(league.name);
    setEditDescription(league.description || "");
    setEditSeason(league.season || "");
    setEditStatus(league.status);
    setEditMaxRoster(league.config?.maxRoster || 14);
    setEditMaxPoints(league.config?.maxPointsPerMatchDay || 3);
    setEditDeputyId(league.deputy?.id || "");
    setShowAddHelper(false);
    setHelperSearch("");
    setDirty(false);
    setEditSection("info");
  };

  const saveInfo = async () => {
    await fetch(`/api/leagues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        description: editDescription.trim() || null,
        season: editSeason.trim() || null,
        status: editStatus,
        config: { maxRoster: editMaxRoster, maxPointsPerMatchDay: editMaxPoints },
        deputyId: editDeputyId || null,
      }),
    });
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
    await fetch(`/api/leagues/${id}/categories`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: cat.id, name: cat.name, format: cat.format, gender: cat.gender, ageGroup: cat.ageGroup, skillMin: cat.skillMin, skillMax: cat.skillMax, scoringFormat: cat.scoringFormat, winBy: cat.winBy, status: cat.status }),
    });
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

  const openAddPlayerModal = async (team: LeagueTeam) => {
    setAddPlayerTeam(team);
    setAddPlayerSearch("");
    const clubId = team.clubId || team.club?.id;
    setAddPlayerFilter(clubId ? "club" : "all");
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
    const body = {
      name,
      slogan: editTeamSlogan.trim() || null,
      clubId: editTeamClubId || null,
      captainId: editTeamCaptainId || null,
      viceCaptainId: editTeamViceCaptainId || null,
    };
    if (teamId) {
      const r = await fetch(`/api/leagues/${id}/teams/${teamId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Failed to save team"); return; }
    } else {
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

  const addPlayerToTeam = async (teamId: string, playerId: string) => {
    await fetch(`/api/leagues/${id}/teams/${teamId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchLeague();
  };

  const removePlayerFromTeam = async (teamId: string, playerId: string) => {
    await fetch(`/api/leagues/${id}/teams/${teamId}/players`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchLeague();
  };

  const addRound = async () => {
    const matchDays = newRoundTeam1 && newRoundTeam2 ? [{ teamIds: [newRoundTeam1, newRoundTeam2], hostTeamId: newRoundTeam1, date: newRoundDate || undefined }] : [];
    await fetch(`/api/leagues/${id}/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundNumber: newRoundNumber, name: newRoundName.trim() || undefined, suggestedDate: newRoundDate || undefined, matchDays }),
    });
    setShowAddRound(false); setNewRoundName(""); setNewRoundDate(""); setNewRoundTeam1(""); setNewRoundTeam2("");
    fetchLeague(); fetchStandings();
  };

  const createEvent = async (matchDayId: string) => {
    const r = await fetch(`/api/leagues/${id}/match-days/${matchDayId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_event" }),
    });
    if (r.ok) { fetchLeague(); }
    else { const d = await r.json().catch(() => ({})); alert(d.error || "Failed"); }
  };

  const setGameWinner = async (matchDayId: string, gameId: string, winnerId: string | null) => {
    await fetch(`/api/leagues/${id}/match-days/${matchDayId}/games`, {
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
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
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
              <input type="number" value={editMaxRoster} onChange={(e) => { setEditMaxRoster(parseInt(e.target.value) || 0); setDirty(true); }} min={1}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max Pts / Match Day</label>
              <input type="number" value={editMaxPoints} onChange={(e) => { setEditMaxPoints(parseInt(e.target.value) || 0); setDirty(true); }} min={1}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
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
      <option value="cap13">Cap 13</option><option value="cap15">Cap 15</option><option value="cap17">Cap 17</option>
      <option value="cap18">Cap 18</option><option value="cap23">Cap 23</option><option value="cap25">Cap 25</option>
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
              <p className="text-xs text-muted">{cat.format} · {genderLabel(cat.gender)}{cat.ageGroup !== "open" ? ` · ${cat.ageGroup}` : ""} · {scoringLabel(cat.scoringFormat)} · win by {cat.winBy}</p>
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
          <div><label className="block text-xs text-muted mb-1">Level (DUPR)</label><div className="flex items-center gap-1.5"><select value={cat.skillMin ?? ""} onChange={(e) => updateCat("skillMin", e.target.value ? parseFloat(e.target.value) : null)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">{SKILL_OPTS.map((s) => <option key={s} value={s}>{s || "From"}</option>)}</select><span className="text-xs text-muted">–</span><select value={cat.skillMax ?? ""} onChange={(e) => updateCat("skillMax", e.target.value ? parseFloat(e.target.value) : null)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">{SKILL_OPTS.map((s) => <option key={s} value={s}>{s || "To"}</option>)}</select></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs text-muted mb-1">Scoring</label>{scoringSelect(cat.scoringFormat, (v) => updateCat("scoringFormat", v))}</div><div><label className="block text-xs text-muted mb-1">Win by</label>{winBySelect(cat.winBy, (v) => updateCat("winBy", v))}</div></div>
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
          <div><label className="block text-xs text-muted mb-1">Level (DUPR)</label><div className="flex items-center gap-1.5"><select value={newCatSkillMin} onChange={(e) => setNewCatSkillMin(e.target.value)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">{SKILL_OPTS.map((s) => <option key={s} value={s}>{s || "From"}</option>)}</select><span className="text-xs text-muted">–</span><select value={newCatSkillMax} onChange={(e) => setNewCatSkillMax(e.target.value)} className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">{SKILL_OPTS.map((s) => <option key={s} value={s}>{s || "To"}</option>)}</select></div></div>
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

  return (
    <div className="space-y-4">
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
              league.status === "active" ? "bg-green-100 text-green-700" : league.status === "completed" ? "bg-gray-100 text-muted" : "bg-blue-100 text-blue-700"
            }`}>{league.status}</span>
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
        {(["overview", "standings", "rounds", "matches", "teams"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-all ${
              tab === t ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}>{t}</button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === "overview" && (
        <div className="space-y-3">
          {/* League Format card */}
          <div onClick={() => { if (canEdit) { startEditInfo(); setEditSection("format"); } }}
            className={`bg-card rounded-xl border border-border p-4 space-y-2 ${canEdit ? "active:opacity-70 cursor-pointer" : ""}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">League Format</h3>
              {canEdit && <span className="text-muted"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></span>}
            </div>
            <div className="text-sm space-y-1">
              <p><span className="text-xs text-muted">Max roster </span><span className="font-medium">{league.config?.maxRoster || "—"}</span><span className="text-xs text-muted"> · Max pts/day </span><span className="font-medium">{league.config?.maxPointsPerMatchDay || "—"}</span></p>
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
                  <span className="text-xs text-muted">{cat.format} · {cat.gender}</span>
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
                    <td className="text-center px-2 py-2 font-bold">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
              <div className="px-3 py-2 bg-gray-50 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold">{round.name || `Round ${round.roundNumber}`}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  round.status === "completed" ? "bg-green-100 text-green-700" : round.status === "in_progress" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-muted"
                }`}>{round.status}</span>
              </div>
              {round.matchDays.map((md) => (
                <div key={md.id} className="px-3 py-3 border-b border-border last:border-0">
                  {/* Teams */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {md.teams.map((t, i) => (
                        <span key={t.teamId} className="text-sm font-medium">
                          {i > 0 && <span className="text-muted mx-1">vs</span>}
                          {t.team.name}
                          {t.teamId === md.hostTeamId && <span className="text-[9px] text-muted ml-1">(H)</span>}
                        </span>
                      ))}
                    </div>
                    {md.date && <span className="text-xs text-muted">{new Date(md.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                  </div>

                  {/* Team points summary */}
                  <div className="flex gap-2 mb-2">
                    {md.teams.map((t) => (
                      <span key={t.teamId} className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                        {t.team.name}: <span className="font-bold">{t.points}</span> pts
                      </span>
                    ))}
                  </div>

                  {/* Games */}
                  {md.games.length > 0 && (
                    <div className="space-y-1">
                      {md.games.map((game) => (
                        <div key={game.id} className="flex items-center gap-2 text-xs">
                          <span className="text-muted w-24 truncate">{game.category.name}</span>
                          <span className={`flex-1 font-medium ${game.winner?.id === game.team1.id ? "text-green-600" : ""}`}>{game.team1.name}</span>
                          <span className="text-muted">vs</span>
                          <span className={`flex-1 font-medium text-right ${game.winner?.id === game.team2.id ? "text-green-600" : ""}`}>{game.team2.name}</span>
                          {/* Winner selector */}
                          <select value={game.winner?.id || ""} onChange={(e) => setGameWinner(md.id, game.id, e.target.value || null)}
                            className="text-[10px] border border-border rounded px-1 py-0.5 w-20">
                            <option value="">TBD</option>
                            <option value={game.team1.id}>{game.team1.name}</option>
                            <option value={game.team2.id}>{game.team2.name}</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Event link or create */}
                  <div className="mt-2">
                    {md.event ? (
                      <Link href={`/events/${md.event.id}`} className="text-xs text-action font-medium hover:underline">
                        📅 {md.event.name} ({md.event.status})
                      </Link>
                    ) : (
                      <button onClick={() => createEvent(md.id)} className="text-xs text-action font-medium hover:underline">
                        + Create Event
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Add round */}
          {!showAddRound ? (
            <button onClick={() => setShowAddRound(true)}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5">
              + Add Round
            </button>
          ) : (
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div className="flex gap-3">
                <div className="w-20">
                  <label className="block text-xs text-muted mb-1">Round #</label>
                  <input type="number" value={newRoundNumber} onChange={(e) => setNewRoundNumber(parseInt(e.target.value) || 1)} min={1}
                    className="w-full border border-border rounded-lg px-2 py-2 text-sm" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-muted mb-1">Name</label>
                  <input type="text" value={newRoundName} onChange={(e) => setNewRoundName(e.target.value)}
                    placeholder={`Jornada ${newRoundNumber}`}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Date</label>
                <input type="date" value={newRoundDate} onChange={(e) => setNewRoundDate(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              {league.teams.length >= 2 && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-muted mb-1">Home Team</label>
                    <select value={newRoundTeam1} onChange={(e) => setNewRoundTeam1(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                      <option value="">Select...</option>
                      {league.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <span className="self-end pb-2 text-muted">vs</span>
                  <div className="flex-1">
                    <label className="block text-xs text-muted mb-1">Away Team</label>
                    <select value={newRoundTeam2} onChange={(e) => setNewRoundTeam2(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                      <option value="">Select...</option>
                      {league.teams.filter((t) => t.id !== newRoundTeam1).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={addRound} disabled={!newRoundNumber}
                  className="flex-1 bg-action-dark text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">Add Round</button>
                <button onClick={() => setShowAddRound(false)}
                  className="flex-1 bg-gray-100 py-2 rounded-lg text-sm font-medium">Cancel</button>
              </div>
            </div>
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
          {league.teams.map((team) => (
            <div key={team.id} className="bg-card rounded-xl border border-border overflow-hidden">
              {team.photoUrl && (
                <img src={team.photoUrl} alt="" className="w-full max-h-40 object-cover" />
              )}
              <div className="px-3 py-2 bg-gray-50 border-b border-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {team.logoUrl ? <img src={team.logoUrl} alt="" className="w-7 h-7 rounded object-cover" />
                    : team.club?.logoUrl ? <img src={team.club.logoUrl} alt="" className="w-7 h-7 rounded object-cover" />
                    : <span className="text-lg">{team.club?.emoji || "🏟️"}</span>}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm truncate">{team.name}</span>
                      <span className="text-xs text-muted shrink-0">({team._count.players})</span>
                    </div>
                    {team.slogan && <div className="text-[11px] italic text-muted truncate">&ldquo;{team.slogan}&rdquo;</div>}
                  </div>
                </div>
                {canEdit && (
                  <button onClick={() => openTeamEdit(team)} className="text-muted hover:text-foreground p-1 shrink-0" aria-label="Edit team">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                )}
              </div>
              {/* Leader / Deputy */}
              {(team.captain || team.viceCaptain) && (
                <div className="px-3 py-1.5 text-xs text-muted flex gap-3 border-b border-border">
                  {team.captain && <span>Leader: <span className="font-medium text-foreground">{team.captain.name}</span></span>}
                  {team.viceCaptain && <span>Deputy: <span className="font-medium text-foreground">{team.viceCaptain.name}</span></span>}
                </div>
              )}
              {/* Player roster */}
              <div className="px-3 py-2 space-y-1">
                {team.players.map((tp) => (
                  <div key={tp.id} className="flex items-center gap-2 py-1">
                    <PlayerAvatar name={tp.player.name} photoUrl={tp.player.photoUrl} size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{tp.player.name}</div>
                      {tp.player.email && <div className="text-[10px] text-muted truncate">{tp.player.email}</div>}
                    </div>
                    <span className="text-xs text-muted">{tp.player.rating.toFixed(0)}</span>
                    {canEdit && <button onClick={() => removePlayerFromTeam(team.id, tp.playerId)} className="text-xs text-danger px-1 hover:underline">✕</button>}
                  </div>
                ))}
                {canEdit && (
                  <button onClick={() => openAddPlayerModal(team)}
                    className="text-xs text-primary font-medium mt-1">+ Add Player</button>
                )}
              </div>
            </div>
          ))}

          {canEdit && (
            <button onClick={() => openTeamEdit(null)}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5">
              + Add Team
            </button>
          )}
        </div>
      )}

      {/* Add Player Modal */}
      {addPlayerTeam && (() => {
        const team = addPlayerTeam;
        const teamClubId = team.clubId || team.club?.id;
        const onTeamIds = new Set(team.players.map((tp) => tp.playerId));
        const allClubMembers = teamClubId ? (clubMembersCache[teamClubId] || []) : [];
        const source = addPlayerFilter === "club" ? allClubMembers : allPlayers;
        const search = addPlayerSearch.toLowerCase();
        const results = source
          .filter((p) => !onTeamIds.has(p.id) && p.name.toLowerCase().includes(search))
          .slice(0, 50);

        return (
          <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setAddPlayerTeam(null)}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">Add Player to {team.name}</h3>
                  <button onClick={() => setAddPlayerTeam(null)} className="text-muted text-lg leading-none">✕</button>
                </div>
                {teamClubId && (
                  <div className="flex gap-1 mb-2">
                    <button onClick={() => setAddPlayerFilter("club")}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${addPlayerFilter === "club" ? "bg-action text-white" : "bg-gray-100 text-muted"}`}>
                      {team.club?.name || "Club"} members
                    </button>
                    <button onClick={() => setAddPlayerFilter("all")}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${addPlayerFilter === "all" ? "bg-action text-white" : "bg-gray-100 text-muted"}`}>
                      All players
                    </button>
                  </div>
                )}
                <input type="text" value={addPlayerSearch} onChange={(e) => setAddPlayerSearch(e.target.value)}
                  placeholder="Search by name..." autoFocus
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-1">
                {results.length === 0 ? (
                  <p className="text-xs text-muted text-center py-6">
                    {addPlayerFilter === "club" && allClubMembers.length === 0 ? "No club members found" : "No players match"}
                  </p>
                ) : (
                  results.map((p) => (
                    <button key={p.id} onClick={async () => {
                      await addPlayerToTeam(team.id, p.id);
                      // refresh team in modal so the just-added player disappears from results
                      const updated = await fetch(`/api/leagues/${id}`).then((r) => r.json()).catch(() => null);
                      if (updated) {
                        setLeague(updated);
                        const fresh = updated.teams.find((t: LeagueTeam) => t.id === team.id);
                        if (fresh) setAddPlayerTeam(fresh);
                      }
                    }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-left">
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        {p.email && <div className="text-[10px] text-muted truncate">{p.email}</div>}
                      </div>
                      <span className="text-xs text-muted">{p.rating?.toFixed(0)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
