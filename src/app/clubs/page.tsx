"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ClearInput } from "@/components/ClearInput";

interface Club {
  id: string;
  name: string;
  emoji: string;
  logoUrl?: string | null;
  description?: string | null;
  city?: string | null;
  country?: string | null;
  myRole: string;
  _count: { members: number; events: number };
}

interface BrowseClub {
  id: string;
  name: string;
  emoji: string;
  logoUrl?: string | null;
  description: string | null;
  memberCount: number;
  eventCount: number;
  city: string | null;
  country: string | null;
}

export default function ClubsPage() {
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🏓");
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
  const [requesting, setRequesting] = useState<string | null>(null);

  const myClubIds = new Set(clubs.map((c) => c.id));

  const EMOJIS = ["🏓", "🎾", "⚡", "🔥", "🌟", "💪", "🏆", "🎯", "🦅", "🐉"];

  const fetchClubs = async () => {
    const r = await fetch("/api/clubs");
    if (r.ok) setClubs(await r.json());
    setLoading(false);
  };

  useEffect(() => { if (isLoggedIn) fetchClubs(); else setLoading(false); }, [isLoggedIn]);

  const createClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    await fetch("/api/clubs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), emoji: newEmoji }),
    });
    setNewName("");
    setNewEmoji("🏓");
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

  const requestJoin = async (clubId: string) => {
    setRequesting(clubId);
    const r = await fetch(`/api/clubs/${clubId}/join-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (r.ok) {
      setRequestedClubIds((prev) => new Set([...prev, clubId]));
    } else {
      const data = await r.json();
      if (data.error === "Already a member") {
        fetchClubs();
      }
    }
    setRequesting(null);
  };

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">My Clubs</h2>
        <div className="flex gap-2">
          {isLoggedIn && (
            <button onClick={() => setShowCreate(!showCreate)}
              className="text-primary text-sm font-medium">
              {showCreate ? "Cancel" : "+ New Club"}
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createClub} className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Club Name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Tuesday Crew"
              className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Icon</label>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => setNewEmoji(e)}
                  className={`text-2xl p-1 rounded-lg transition-all ${newEmoji === e ? "bg-primary/10 ring-2 ring-primary scale-110" : "hover:bg-gray-100"}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={!newName.trim() || creating}
            className="w-full bg-action-dark text-white py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50">
            {creating ? "Creating..." : "Create Club"}
          </button>
        </form>
      )}

      {/* My clubs */}
      {clubs.length === 0 && isLoggedIn ? (
        <div className="text-center py-8">
          <p className="text-muted text-sm">You haven&apos;t joined any clubs yet</p>
        </div>
      ) : !isLoggedIn ? (
        <div className="text-center py-8">
          <p className="text-muted text-sm">Sign in to see your clubs</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clubs.map((club) => (
            <div key={club.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <Link href={`/clubs/${club.id}`}
                className="block p-4 active:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover" /> : <span className="text-3xl">{club.emoji}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{club.name}</span>
                      <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium capitalize">{club.myRole}</span>
                    </div>
                    <p className="text-sm text-muted">
                      {club._count.members} member{club._count.members !== 1 ? "s" : ""} &middot; {club._count.events} event{club._count.events !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInfoClubId(infoClubId === club.id ? null : club.id); }}
                    className="text-muted hover:text-foreground text-sm w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100">ⓘ</button>
                  <span className="text-2xl text-muted">›</span>
                </div>
              </Link>
              {infoClubId === club.id && (
                <div className="px-4 pb-3 pt-1 border-t border-border text-sm text-muted space-y-1">
                  {club.description && <p>{club.description}</p>}
                  {(club.city || club.country) && <p>{[club.city, club.country].filter(Boolean).join(", ")}</p>}
                  {!club.description && !club.city && !club.country && <p className="italic">No additional info</p>}
                </div>
              )}
            </div>
          ))}
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
                {browseClubs.filter((c) => !myClubIds.has(c.id)).map((club) => {
                  const isPending = requestedClubIds.has(club.id);
                  const isRequesting = requesting === club.id;
                  return (
                    <div key={club.id} className="bg-card rounded-xl border border-border overflow-hidden">
                      <div className="flex items-center gap-3 p-4">
                        {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover" /> : <span className="text-2xl">{club.emoji}</span>}
                        <div className="flex-1 min-w-0">
                          <span className="font-semibold">{club.name}</span>
                          <p className="text-xs text-muted">
                            {club.memberCount} member{club.memberCount !== 1 ? "s" : ""}
                            {club.city && ` · ${club.city}`}
                            {club.country && !club.city && ` · ${club.country}`}
                          </p>
                        </div>
                        <button onClick={() => setInfoClubId(infoClubId === club.id ? null : club.id)}
                          className="text-muted hover:text-foreground text-sm w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100">ⓘ</button>
                        {isLoggedIn && (
                          isPending ? (
                            <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded-lg">Requested</span>
                          ) : (
                            <button onClick={() => requestJoin(club.id)} disabled={isRequesting}
                              className="text-xs text-action font-medium px-3 py-1.5 rounded-lg border border-action/30 hover:bg-action/5 disabled:opacity-50">
                              {isRequesting ? "..." : "Request to Join"}
                            </button>
                          )
                        )}
                        {!isLoggedIn && (
                          <Link href="/signin" className="text-xs text-action font-medium">Sign in to join</Link>
                        )}
                      </div>
                      {infoClubId === club.id && (
                        <div className="px-4 pb-3 pt-1 border-t border-border text-sm text-muted space-y-1">
                          {club.description && <p>{club.description}</p>}
                          {(club.city || club.country) && <p>{[club.city, club.country].filter(Boolean).join(", ")}</p>}
                          {!club.description && !club.city && !club.country && <p className="italic">No additional info</p>}
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
