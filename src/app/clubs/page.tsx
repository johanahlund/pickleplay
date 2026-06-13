"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ClearInput } from "@/components/ClearInput";
import { COUNTRIES } from "@/lib/countries";
import { setPreview } from "@/lib/entityPreview";
import { frameClass } from "@/components/Card";
import { clubRoleLabel } from "@/lib/clubLabel";
import { useConfirm } from "@/components/ConfirmDialog";
import { usePollingRefresh } from "@/lib/hooks";
import { LoadingState } from "@/components/LoadingState";
import { useHeaderTitle } from "@/components/HeaderBack";

interface ClubLocation {
  id: string;
  name: string;
  googleMapsUrl?: string | null;
}

interface Club {
  id: string;
  name: string;
  emoji: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  city?: string | null;
  country?: string | null;
  locations?: ClubLocation[];
  myRole: string;
  members: { role: string; player: { id: string; name: string; gender?: string | null } }[];
  _count: { members: number; events: number };
}

interface BrowseClub {
  id: string;
  name: string;
  emoji: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  description: string | null;
  memberCount: number;
  eventCount: number;
  city: string | null;
  country: string | null;
  locations?: ClubLocation[];
  members: { role: string; player: { id: string; name: string; gender?: string | null } }[];
}

export default function ClubsPage() {
  const { data: session } = useSession();
  const { confirm: confirmDialog, alert: alertDialog } = useConfirm();
  const isLoggedIn = !!session?.user;
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newStatus, setNewStatus] = useState<"draft" | "active" | "closed">("active");
  const [newLocations, setNewLocations] = useState<{ name: string; googleMapsUrl: string }[]>([]);
  const [newLogoFile, setNewLogoFile] = useState<File | null>(null);
  const [newLogoPreview, setNewLogoPreview] = useState<string | null>(null);
  const [newCoverFile, setNewCoverFile] = useState<File | null>(null);
  const [newCoverPreview, setNewCoverPreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [infoClubId, setInfoClubId] = useState<string | null>(null);

  // Browse state
  const [browseClubs, setBrowseClubs] = useState<BrowseClub[]>([]);
  const [browseSearch, setBrowseSearch] = useState("");
  const [browseCountry, setBrowseCountry] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [requestedClubIds, setRequestedClubIds] = useState<Set<string>>(new Set());
  const [pendingRequests, setPendingRequests] = useState<BrowseClub[]>([]);
  const [requesting, setRequesting] = useState<string | null>(null);

  const myClubIds = new Set(clubs.map((c) => c.id));


  // Removed memberships are surfaced via the bell-icon notification
  // inbox (server writes a Notification row when a director kicks
  // someone). No client-side modal here.
  const fetchClubs = async () => {
    const r = await fetch("/api/clubs");
    if (r.ok) setClubs(await r.json());
    setLoading(false);
  };

  // Fetch the user's pending join requests so the "Pending" section
  // renders on reload AND the "Requested" state survives a refresh.
  // Accept/decline notifications are delivered via the bell-icon
  // inbox (server writes a Notification row on PATCH), not as modals.
  const fetchMyPendingRequests = async () => {
    const r = await fetch("/api/clubs/join-requests/mine");
    if (!r.ok) return;
    const data: { requestId: string; club: BrowseClub & { _count?: { members?: number; events?: number } } }[] = await r.json();
    const items: BrowseClub[] = data.map((d) => ({
      id: d.club.id,
      name: d.club.name,
      emoji: d.club.emoji,
      logoUrl: d.club.logoUrl ?? null,
      coverUrl: d.club.coverUrl ?? null,
      description: null,
      memberCount: d.club._count?.members ?? 0,
      eventCount: d.club._count?.events ?? 0,
      city: d.club.city ?? null,
      country: d.club.country ?? null,
      members: d.club.members ?? [],
    }));
    setPendingRequests(items);
    setRequestedClubIds(new Set(items.map((c) => c.id)));
  };

  useEffect(() => {
    if (isLoggedIn) { fetchClubs(); fetchMyPendingRequests(); }
    else setLoading(false);
  }, [isLoggedIn]);

  // Light background refresh so when a club admin accepts (or declines)
  // your join request elsewhere, the change shows up here without a
  // manual reload. `usePollingRefresh` also re-fires on tab focus, which
  // is the more useful trigger — pending requests don't move minute to
  // minute, so a 60s baseline is plenty.
  usePollingRefresh(
    async () => { if (isLoggedIn) { await fetchClubs(); await fetchMyPendingRequests(); } },
    60000,
    isLoggedIn,
  );

  const createClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const r = await fetch("/api/clubs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        shortName: newShortName.trim() || undefined,
        description: newDescription.trim() || undefined,
        city: newCity.trim() || undefined,
        country: newCountry.trim() || undefined,
        status: newStatus,
        locations: newLocations.filter((l) => l.name.trim()),
      }),
    });
    if (r.ok) {
      const club = await r.json();
      // Upload logo and cover if selected
      const uploads: Promise<void>[] = [];
      if (newLogoFile) {
        const fd = new FormData();
        fd.append("file", newLogoFile);
        fd.append("type", "logo");
        uploads.push(fetch(`/api/clubs/${club.id}/photo`, { method: "POST", body: fd }).then(() => {}));
      }
      if (newCoverFile) {
        const fd = new FormData();
        fd.append("file", newCoverFile);
        fd.append("type", "cover");
        uploads.push(fetch(`/api/clubs/${club.id}/photo`, { method: "POST", body: fd }).then(() => {}));
      }
      await Promise.all(uploads);
    }
    setNewName(""); setNewShortName(""); setNewDescription(""); setNewCity(""); setNewCountry(""); setNewStatus("active");
    setNewLocations([]); setNewLogoFile(null); setNewLogoPreview(null);
    setNewCoverFile(null); setNewCoverPreview(null);
    setShowCreate(false);
    setCreating(false);
    fetchClubs();
  };

  const fetchCountries = async () => {
    if (countries.length > 0) return;
    const r = await fetch("/api/clubs/browse?countries=1");
    if (r.ok) setCountries(await r.json());
  };

  const searchBrowse = async (q?: string, country?: string) => {
    setBrowseLoading(true);
    fetchCountries();
    const params = new URLSearchParams();
    if (q || browseSearch) params.set("q", q || browseSearch);
    const c = country !== undefined ? country : browseCountry;
    if (c) params.set("country", c);
    const r = await fetch(`/api/clubs/browse?${params}`);
    if (r.ok) {
      setBrowseClubs(await r.json());
    }
    setBrowseLoading(false);
  };

  const requestJoin = async (club: BrowseClub) => {
    const director = club.members.find((m) => m.role === "owner");
    const ok = await confirmDialog({
      title: `Request to join ${club.name}?`,
      message:
        `Your name and profile will be sent to ${director ? director.player.name : "the club director"} for approval. ` +
        `You'll get access to the club's members, events and feed once they accept. ` +
        `You can cancel this request any time before it's reviewed.`,
      confirmText: "Send request",
      cancelText: "Not now",
    });
    if (!ok) return;
    setRequesting(club.id);
    const r = await fetch(`/api/clubs/${club.id}/join-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (r.ok) {
      setRequestedClubIds((prev) => new Set([...prev, club.id]));
      setPendingRequests((prev) => (prev.some((p) => p.id === club.id) ? prev : [club, ...prev]));
    } else {
      const data = await r.json();
      if (data.error === "Already a member") {
        fetchClubs();
      } else {
        await alertDialog(data.error || "Failed to send request", "Error");
      }
    }
    setRequesting(null);
  };

  const cancelRequest = async (club: BrowseClub) => {
    const ok = await confirmDialog({
      title: "Cancel join request?",
      message: `${club.name} won't be notified — your pending request is just withdrawn. You can request again later.`,
      confirmText: "Cancel request",
      cancelText: "Keep waiting",
      danger: true,
    });
    if (!ok) return;
    setRequesting(club.id);
    const r = await fetch(`/api/clubs/${club.id}/join-request`, { method: "DELETE" });
    if (r.ok) {
      setRequestedClubIds((prev) => {
        const next = new Set(prev);
        next.delete(club.id);
        return next;
      });
      setPendingRequests((prev) => prev.filter((p) => p.id !== club.id));
    } else {
      const data = await r.json().catch(() => ({}));
      // "Already accepted" race: the bell-icon inbox already has the
      // server-generated welcome notification, so we just silently
      // refresh both lists — the club will appear under My Clubs and
      // disappear from Pending. Show an error toast for other failures.
      const message: string = data.error || "";
      if (typeof message === "string" && message.toLowerCase().includes("already accepted")) {
        await Promise.all([fetchClubs(), fetchMyPendingRequests()]);
      } else {
        await alertDialog(message || "Failed to cancel request", "Error");
      }
    }
    setRequesting(null);
  };

  // Loading handled inline

  useHeaderTitle("My Clubs");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex gap-2">
          {isLoggedIn && (() => {
            // Only app admins and users with the canCreateClubs flag
            // can create a new club. Hide the "+ Club" button for
            // everyone else.
            const role = (session?.user as { role?: string } | undefined)?.role;
            const canCreateClubs = !!(session?.user as { canCreateClubs?: boolean } | undefined)?.canCreateClubs;
            const canCreate = role === "admin" || canCreateClubs;
            if (!canCreate) return null;
            return (
              <button onClick={() => setShowCreate(!showCreate)}
                className={showCreate
                  ? "text-muted text-sm font-medium px-3 py-2"
                  : "text-action border border-action/30 px-4 py-2 rounded-lg font-medium text-sm hover:bg-action/5 active:bg-action/10 transition-colors"}>
                {showCreate ? "Cancel" : "+ Club"}
              </button>
            );
          })()}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createClub} className={`${frameClass} p-4 space-y-3`}>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Club Name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Tuesday Crew"
              className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Short Name <span className="text-muted font-normal">(≤20 chars, used in pills)</span></label>
            <input type="text" value={newShortName} onChange={(e) => setNewShortName(e.target.value.slice(0, 20))}
              maxLength={20}
              placeholder="e.g. Tue Crew"
              className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Logo</label>
            <div className="flex items-center gap-3">
              {newLogoPreview ? (
                <img src={newLogoPreview} alt="Logo" className="w-16 h-16 rounded-xl object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-2xl text-muted">🏓</div>
              )}
              <label className="text-xs text-action font-medium cursor-pointer hover:underline">
                {newLogoPreview ? "Change logo" : "Upload logo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setNewLogoFile(file);
                  setNewLogoPreview(URL.createObjectURL(file));
                }} />
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Cover Photo</label>
            <div>
              {newCoverPreview && (
                <img src={newCoverPreview} alt="Cover" className="w-full h-24 rounded-lg object-cover mb-2" />
              )}
              <label className="text-xs text-action font-medium cursor-pointer hover:underline">
                {newCoverPreview ? "Change cover" : "Upload cover photo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setNewCoverFile(file);
                  setNewCoverPreview(URL.createObjectURL(file));
                }} />
              </label>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-muted mb-1">City</label>
              <input type="text" value={newCity} onChange={(e) => setNewCity(e.target.value)}
                placeholder="e.g. Setúbal"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-muted mb-1">Country</label>
              <select value={newCountry} onChange={(e) => setNewCountry(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white">
                <option value="">Select country...</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Status</label>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as "draft" | "active" | "closed")}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Description</label>
            <textarea
              value={newDescription} onChange={(e) => setNewDescription(e.target.value)}
              rows={3} placeholder="Tell members about this club..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Locations</label>
            <div className="space-y-2">
              {newLocations.map((loc, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1">
                    <input
                      type="text" value={loc.name} placeholder="Location name"
                      onChange={(e) => {
                        const next = [...newLocations];
                        next[i] = { ...next[i], name: e.target.value };
                        setNewLocations(next);
                      }}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <input
                      type="url" value={loc.googleMapsUrl} placeholder="Google Maps URL"
                      onChange={(e) => {
                        const next = [...newLocations];
                        next[i] = { ...next[i], googleMapsUrl: e.target.value };
                        setNewLocations(next);
                      }}
                      className="w-full border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <button type="button"
                    onClick={() => setNewLocations(newLocations.filter((_, j) => j !== i))}
                    className="text-xs text-danger px-2 py-2 rounded hover:bg-red-50 mt-1"
                  >✕</button>
                </div>
              ))}
              <button type="button"
                onClick={() => setNewLocations([...newLocations, { name: "", googleMapsUrl: "" }])}
                className="text-xs text-primary font-medium"
              >+ Add Location</button>
            </div>
          </div>
          <button type="submit" disabled={!newName.trim() || creating}
            className="w-full bg-white border border-action text-action py-2.5 rounded-lg font-semibold hover:bg-action/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {creating ? "Creating..." : "Create Club"}
          </button>
        </form>
      )}

      {/* My clubs */}
      {loading ? (
        <LoadingState label="Loading clubs…" />
      ) : clubs.length === 0 && isLoggedIn ? (
        <div className="text-center py-8">
          <p className="text-muted text-sm">You haven&apos;t joined any clubs yet</p>
        </div>
      ) : !isLoggedIn ? (
        <div className="text-center py-8">
          <p className="text-muted text-sm">Sign in to see your clubs</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clubs.map((club) => {
            const owner = club.members.find((m) => m.role === "owner");
            const admins = club.members.filter((m) => m.role === "admin");
            const males = club.members.filter((m) => m.player.gender === "M").length;
            const females = club.members.filter((m) => m.player.gender === "F").length;
            return (
            <div key={club.id} className={`${frameClass} overflow-hidden`}>
              <Link
                href={`/clubs/${club.id}`}
                onClick={() => setPreview("club", club.id, club)}
                className="block p-4 active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {club.logoUrl
                    ? <img src={club.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    : <div className="w-10 h-10 rounded-xl bg-gray-100 border border-border shrink-0" aria-hidden />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{club.name}</span>
                      <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium">{clubRoleLabel(club.myRole)}</span>
                    </div>
                    {owner && (
                      <div className="text-[11px] text-muted truncate">
                        Director: <span className="text-foreground font-medium">{owner.player.name}</span>
                      </div>
                    )}
                    {admins.length > 0 && (
                      <div className="text-[11px] text-muted truncate">
                        Admin{admins.length === 1 ? "" : "s"}: <span className="text-foreground font-medium">{admins.map((a) => a.player.name).join(", ")}</span>
                      </div>
                    )}
                    <div className="text-[11px] text-muted">
                      {club._count.members} member{club._count.members !== 1 ? "s" : ""}
                      <span className="text-blue-500"> · {males}♂</span>
                      <span className="text-pink-500"> · {females}♀</span>
                      <span> · {club._count.events} event{club._count.events !== 1 ? "s" : ""}</span>
                      {(club.city || club.country) && (
                        <span> · {[club.city, club.country].filter(Boolean).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-2xl text-muted">›</span>
                </div>
              </Link>
              {infoClubId === club.id && (
                <div className="border-t border-border">
                  {club.coverUrl && <img src={club.coverUrl} alt="" className="w-full h-32 object-cover" />}
                  <div className="px-4 pb-3 pt-2 text-sm text-muted space-y-2">
                    {club.description && <p>{club.description}</p>}
                    {(club.city || club.country) && <p>{[club.city, club.country].filter(Boolean).join(", ")}</p>}
                    {club.locations && club.locations.length > 0 && (
                      <div className="space-y-1">
                        {club.locations.map((loc) => (
                          <div key={loc.id}>
                            {loc.googleMapsUrl ? (
                              <a href={loc.googleMapsUrl} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-action text-xs hover:underline">📍 {loc.name}</a>
                            ) : (
                              <span className="text-xs">📍 {loc.name}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!club.description && !club.city && !club.country && (!club.locations || club.locations.length === 0) && (
                      <p className="italic">No additional info</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Pending join requests — the clubs you've applied to but not yet
          been accepted into. Lives between My Clubs and Find Clubs so it's
          always visible without having to dig into the Find Clubs section. */}
      {pendingRequests.length > 0 && (
        <div className="border-t border-border pt-4">
          <h3 className="text-lg font-bold mb-2">Pending requests to join club</h3>
          <div className="space-y-2">
            {pendingRequests.map((club) => {
              const director = club.members.find((m) => m.role === "owner");
              const pAdmins = club.members.filter((m) => m.role === "admin");
              const isCanceling = requesting === club.id;
              return (
                <div key={club.id} className={`${frameClass} overflow-hidden`}>
                  <div className="flex items-center gap-3 p-4">
                    <Link
                      href={`/clubs/${club.id}`}
                      onClick={() => setPreview("club", club.id, { id: club.id, name: club.name, emoji: club.emoji, logoUrl: club.logoUrl, coverUrl: club.coverUrl, description: club.description, city: club.city, country: club.country, _count: { members: club.memberCount, events: club.eventCount } })}
                      className="flex items-center gap-3 flex-1 min-w-0 active:opacity-70"
                    >
                      {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" /> : <div className="w-8 h-8 rounded-lg bg-gray-100 border border-border shrink-0" aria-hidden />}
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold">{club.name}</span>
                        {director && (
                          <div className="text-[11px] text-muted truncate">
                            Director: <span className="text-foreground font-medium">{director.player.name}</span>
                          </div>
                        )}
                        {pAdmins.length > 0 && (
                          <div className="text-[11px] text-muted truncate">
                            Admin{pAdmins.length === 1 ? "" : "s"}: <span className="text-foreground font-medium">{pAdmins.map((a) => a.player.name).join(", ")}</span>
                          </div>
                        )}
                        <div className="text-[11px] text-amber-700">⏳ Waiting for review</div>
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={() => cancelRequest(club)}
                      disabled={isCanceling}
                      className="text-[11px] text-amber-700 font-medium bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg shrink-0 disabled:opacity-50 underline"
                    >Cancel</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Browse clubs */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => { if (!showBrowse) searchBrowse(""); setShowBrowse(!showBrowse); }}
          className="flex items-center justify-between w-full mb-3"
        >
          <h3 className="text-lg font-bold">Find Clubs</h3>
          <span className={`text-muted text-sm transition-transform ${showBrowse ? "rotate-90" : ""}`}>›</span>
        </button>

        {showBrowse && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <ClearInput value={browseSearch} onChange={(v) => { setBrowseSearch(v); searchBrowse(v); }}
                  placeholder="Search by name..." className="text-sm" />
              </div>
              <select value={browseCountry} onChange={(e) => { setBrowseCountry(e.target.value); searchBrowse(undefined, e.target.value); }}
                className="border border-border rounded-lg px-2 py-1.5 text-sm shrink-0">
                <option value="">All countries</option>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {browseLoading ? (
              <p className="text-sm text-muted text-center py-4">Searching...</p>
            ) : browseClubs.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">No clubs found</p>
            ) : (
              <div className="space-y-2">
                {browseClubs.filter((c) => !myClubIds.has(c.id) && !requestedClubIds.has(c.id)).map((club) => {
                  const isPending = requestedClubIds.has(club.id);
                  const isRequesting = requesting === club.id;
                  const director = club.members.find((m) => m.role === "owner");
                  const browseAdmins = club.members.filter((m) => m.role === "admin");
                  const browseMales = club.members.filter((m) => m.player.gender === "M").length;
                  const browseFemales = club.members.filter((m) => m.player.gender === "F").length;
                  return (
                    <div key={club.id} className={`${frameClass} overflow-hidden`}>
                      <div className="flex items-center gap-3 p-4">
                        {/* Card body is a Link to the detail page so anyone
                            (including app admins not yet a member) can
                            navigate in. The "Request to Join" button is a
                            sibling so its click stays inside the row. */}
                        <Link
                          href={`/clubs/${club.id}`}
                          onClick={() => setPreview("club", club.id, { id: club.id, name: club.name, emoji: club.emoji, logoUrl: club.logoUrl, coverUrl: club.coverUrl, description: club.description, city: club.city, country: club.country, _count: { members: club.memberCount, events: club.eventCount } })}
                          className="flex items-center gap-3 flex-1 min-w-0 active:opacity-70"
                        >
                          {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" /> : <div className="w-8 h-8 rounded-lg bg-gray-100 border border-border shrink-0" aria-hidden />}
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold">{club.name}</span>
                            {director && (
                              <div className="text-[11px] text-muted truncate">
                                Director: <span className="text-foreground font-medium">{director.player.name}</span>
                              </div>
                            )}
                            {browseAdmins.length > 0 && (
                              <div className="text-[11px] text-muted truncate">
                                Admin{browseAdmins.length === 1 ? "" : "s"}: <span className="text-foreground font-medium">{browseAdmins.map((a) => a.player.name).join(", ")}</span>
                              </div>
                            )}
                            <div className="text-[11px] text-muted">
                              {club.memberCount} member{club.memberCount !== 1 ? "s" : ""}
                              <span className="text-blue-500"> · {browseMales}♂</span>
                              <span className="text-pink-500"> · {browseFemales}♀</span>
                              {(club.city || club.country) && (
                                <span> · {[club.city, club.country].filter(Boolean).join(", ")}</span>
                              )}
                            </div>
                          </div>
                        </Link>
                        {isLoggedIn && (
                          isPending ? (
                            <button
                              type="button"
                              onClick={() => cancelRequest(club)}
                              disabled={isRequesting}
                              title="Cancel your join request"
                              className="text-[11px] text-amber-700 font-medium bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg shrink-0 disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              <span>⏳ Requested</span>
                              <span className="text-amber-500">·</span>
                              <span className="underline">cancel</span>
                            </button>
                          ) : (
                            <button onClick={() => requestJoin(club)} disabled={isRequesting}
                              className="text-xs text-action font-medium px-3 py-1.5 rounded-lg border border-action/30 hover:bg-action/5 disabled:opacity-50 shrink-0">
                              {isRequesting ? "..." : "Request to Join"}
                            </button>
                          )
                        )}
                        {!isLoggedIn && (
                          <Link href="/signin" className="text-xs text-action font-medium shrink-0">Sign in to join</Link>
                        )}
                      </div>
                      {infoClubId === club.id && (
                        <div className="border-t border-border">
                          {club.coverUrl && <img src={club.coverUrl} alt="" className="w-full h-32 object-cover" />}
                          <div className="px-4 pb-3 pt-2 text-sm text-muted space-y-2">
                            {club.description && <p>{club.description}</p>}
                            {(club.city || club.country) && <p>{[club.city, club.country].filter(Boolean).join(", ")}</p>}
                            {club.locations && club.locations.length > 0 && (
                              <div className="space-y-1">
                                {club.locations.map((loc) => (
                                  <div key={loc.id}>
                                    {loc.googleMapsUrl ? (
                                      <a href={loc.googleMapsUrl} target="_blank" rel="noopener noreferrer"
                                        className="text-action text-xs hover:underline">📍 {loc.name}</a>
                                    ) : (
                                      <span className="text-xs">📍 {loc.name}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {!club.description && !club.city && !club.country && (!club.locations || club.locations.length === 0) && (
                              <p className="italic">No additional info</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {browseClubs.every((c) => myClubIds.has(c.id)) && (
                  <p className="text-sm text-muted text-center py-2">You&apos;re already in all matching clubs</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
