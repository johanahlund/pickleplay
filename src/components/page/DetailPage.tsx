"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { AppHeader, type HeaderStatus } from "@/components/AppHeader";
import { usePollingRefresh } from "@/lib/hooks";

/**
 * DETAIL archetype — the bold green hero header used across entity pages.
 * Events already use this look; clubs / leagues / profile adopt it via this
 * wrapper so every entity you open feels the same (back + name + status, same
 * spot, same chrome).
 *
 * Pages using this hero are hidden from the global Header.tsx (see its route
 * list) to avoid a double header — so DetailPage re-provides the chrome that
 * Header normally owns: the notification bell (polled here, mirroring
 * Header.tsx) and the user avatar. Callers only describe the entity.
 *
 *   <DetailPage
 *     back={{ label: "Leagues", href: "/leagues" }}
 *     title={league.name}
 *     meta={`Season ${season}`}
 *     status={heroStatus}
 *     onInvite={canEdit ? openShare : undefined}
 *     inviteKind="L"
 *     inviteLabel="Share league invite"
 *   >
 *     …sections…
 *   </DetailPage>
 */
export function DetailPage({
  back,
  title,
  meta,
  status,
  onInvite,
  inviteKind,
  inviteLabel,
  onShareSchedule,
  shareScheduleLabel,
  children,
}: {
  back: { label: string; href?: string; onClick?: () => void };
  title: string;
  meta?: string;
  status?: HeaderStatus;
  onInvite?: () => void;
  inviteKind?: string;
  inviteLabel?: string;
  onShareSchedule?: () => void;
  shareScheduleLabel?: string;
  children?: ReactNode;
}) {
  const { data: session } = useSession();
  const [unread, setUnread] = useState(0);

  // Mirrors Header.tsx's notification polling — pause when signed out / hidden.
  const checkUnread = useCallback(async () => {
    if (!session?.user) return;
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data)) setUnread(data.filter((n: { read: boolean }) => !n.read).length);
    } catch {
      /* ignore */
    }
  }, [session?.user]);
  useEffect(() => {
    checkUnread();
  }, [checkUnread]);
  usePollingRefresh(checkUnread, 30000, !!session?.user);

  const userInitial = session?.user?.name?.[0]?.toUpperCase() ?? "?";

  return (
    <>
      <AppHeader
        variant="hero"
        back={back}
        title={title}
        meta={meta}
        status={status}
        notifications={unread}
        user={{ initial: userInitial, href: "/profile" }}
        onInvite={onInvite}
        inviteKind={inviteKind}
        inviteLabel={inviteLabel}
        onShareSchedule={onShareSchedule}
        shareScheduleLabel={shareScheduleLabel}
      />
      <div className="space-y-4">{children}</div>
    </>
  );
}
