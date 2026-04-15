"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ClearInput } from "@/components/ClearInput";
import { COUNTRIES } from "@/lib/countries";
import { setPreview } from "@/lib/entityPreview";

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
}

export default function ClubsPage() {
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
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
  const [requesting, setRequesting] = useState<string | null>(null);

  const myClubIds = new Set(clubs.map((c) => c.id));


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
    const r = await fetch("/api/clubs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
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
    setNewName(""); setNewDescription(""); setNewCity(""); setNewCountry(""); setNewStatus("active");
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

  // Loading handled inline

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
            className="w-full bg-action-dark text-white py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50">
            {creating ? "Creating..." : "Create Club"}
          </button>
        </form>
      )}

      {/* My clubs */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-action border-t-transparent rounded-full animate-spin" /></div>
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
          {clubs.map((club) => (
            <div key={club.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <Link
                href={`/clubs/${club.id}`}
                onClick={() => setPreview("club", club.id, club)}
                className="block p-4 active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover" /> : <span className="text-3xl">{club.emoji}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{club.name}</span>
                      <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium capitalize">{club.myRole}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted">
                      <span>{club._count.members} member{club._count.members !== 1 ? "s" : ""} · {club._count.events} event{club._count.events !== 1 ? "s" : ""}</span>
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
                          <div className="flex items-center gap-1.5 text-xs text-muted">
                            <span>
                              {club.memberCount} member{club.memberCount !== 1 ? "s" : ""}
                              {club.city && ` · ${club.city}`}
                              {club.country && !club.city && ` · ${club.country}`}
                            </span>
                          </div>
                        </div>
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
