"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useConfirm } from "@/components/ConfirmDialog";

interface MyClub {
  id: string;
  name: string;
  emoji: string;
  myRole: string;
}

export default function NewPlayerPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { alert } = useConfirm();

  const [name, setName] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [clubId, setClubId] = useState<string>("");
  const [clubs, setClubs] = useState<MyClub[]>([]);
  const [saving, setSaving] = useState(false);

  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  useEffect(() => {
    fetch("/api/clubs")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: MyClub[]) => {
        const ownable = data.filter((c) => c.myRole === "owner" || c.myRole === "admin");
        setClubs(ownable);
        if (ownable.length === 1 && !isAdmin) setClubId(ownable[0].id);
      });
  }, [isAdmin]);

  const handleSave = async () => {
    if (!name.trim()) {
      await alert("Name is required", "Missing name");
      return;
    }
    // Non-admin must attach to a club they own/admin
    if (!isAdmin && !clubId) {
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
      }),
    });
    if (r.ok) {
      router.push("/players");
    } else {
      setSaving(false);
      const d = await r.json().catch(() => ({}));
      await alert(d.error || "Failed to add player", "Error");
    }
  };

  const canAdd = name.trim().length > 0 && (isAdmin || !!clubId);

  return (
    <div className="space-y-4">
      <Link href="/players" className="text-sm text-action">&larr; Players</Link>

      <h2 className="text-xl font-bold">Add Player</h2>

      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
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
                  gender === g.value ? "bg-action text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
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
            Club {isAdmin ? "(optional)" : ""}
          </label>
          <select
            value={clubId}
            onChange={(e) => setClubId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">{isAdmin ? "No club" : "Select club..."}</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
          {!isAdmin && clubs.length === 0 && (
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
