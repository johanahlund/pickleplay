"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const r = await fetch("/api/notifications");
    if (r.ok) setItems(await r.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_all" }),
    });
    load();
  };

  const markRead = async (id: string) => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", notificationId: id }),
    });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  // Pull eventId, requestId, classId out of a pair_request notification's
  // linkUrl. linkUrl format: /events/{eventId}?pairRequest={requestId}&class={classId}
  const parsePairRequestLink = (linkUrl: string | null): { eventId: string; requestId: string; classId: string } | null => {
    if (!linkUrl) return null;
    try {
      const url = new URL(linkUrl, "http://x");
      const m = url.pathname.match(/^\/events\/([^/]+)/);
      const eventId = m?.[1];
      const requestId = url.searchParams.get("pairRequest");
      const classId = url.searchParams.get("class");
      if (!eventId || !requestId || !classId) return null;
      return { eventId, requestId, classId };
    } catch {
      return null;
    }
  };

  const deleteAlert = async (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", notificationId: id }),
    });
  };

  const [actingId, setActingId] = useState<string | null>(null);
  const respondPairRequest = async (n: Notification, action: "accept" | "decline") => {
    const ids = parsePairRequestLink(n.linkUrl);
    if (!ids) return;
    setActingId(n.id);
    const r = await fetch(`/api/events/${ids.eventId}/classes/${ids.classId}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, requestId: ids.requestId }),
    });
    setActingId(null);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || "Failed");
      return;
    }
    // The request is resolved — drop the alert.
    deleteAlert(n.id);
  };

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Alerts</h2>
        <div className="flex items-center gap-3">
          {unread > 0 && (
            <button onClick={markAllRead} className="text-sm text-action font-medium">Mark all read</button>
          )}
          {items.some((n) => n.read) && (
            <button onClick={async () => {
              await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_read" }) });
              setItems((prev) => prev.filter((n) => !n.read));
            }} className="text-sm text-muted hover:text-foreground">Clear read</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted text-sm">No alerts yet.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((n) => {
            const isPairRequest = n.type === "pair_request" && !!parsePairRequestLink(n.linkUrl);
            const acting = actingId === n.id;
            return (
              <div key={n.id}
                onClick={() => { if (!n.read) markRead(n.id); }}
                className={`bg-card rounded-xl border border-border p-3 ${n.read ? "opacity-70" : ""} cursor-default`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-action shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <p className={`text-sm ${n.read ? "font-medium" : "font-semibold"} flex-1`}>{n.title}</p>
                      <span className="text-[10px] text-muted shrink-0">{timeAgo(n.createdAt)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteAlert(n.id); }}
                        aria-label="Delete alert"
                        className="text-muted hover:text-danger text-xs shrink-0 px-1 -mt-0.5"
                      >✕</button>
                    </div>
                    {n.body && <p className="text-xs text-muted mt-1">{n.body}</p>}
                    {isPairRequest ? (
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          disabled={acting}
                          onClick={(e) => { e.stopPropagation(); respondPairRequest(n, "accept"); }}
                          className="text-xs bg-action text-white px-3 py-1 rounded-lg font-medium disabled:opacity-50">
                          Accept
                        </button>
                        <button
                          disabled={acting}
                          onClick={(e) => { e.stopPropagation(); respondPairRequest(n, "decline"); }}
                          className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50">
                          Decline
                        </button>
                      </div>
                    ) : n.linkUrl ? (
                      <Link href={n.linkUrl}
                        onClick={(e) => { e.stopPropagation(); if (!n.read) markRead(n.id); }}
                        className="inline-block mt-1.5 text-xs text-action font-medium hover:underline">
                        Open →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
