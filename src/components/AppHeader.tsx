// src/components/AppHeader.tsx

"use client";

import React, { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { BackButton } from "./BackButton";

/** Measure the fixed header element and push its height to:
 *   - the CSS var `--header-height` (used by sticky tab bars below)
 *   - #main-content paddingTop (so the page body sits below the header)
 *
 * Used by every variant since they're all `position: fixed`. The global
 * Header.tsx also runs this for the light variant; both writers stay in
 * sync because the value is the actual measured height. */
function useHeaderHeightSync(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const HEADER_GAP_PX = 24;
    const update = () => {
      const h = el.offsetHeight;
      const main = document.getElementById("main-content");
      if (main) main.style.paddingTop = `${h + HEADER_GAP_PX}px`;
      document.documentElement.style.setProperty("--header-height", `${h}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

export type HeaderStatus = "draft" | "open" | "active" | "completed";

interface AppHeaderProps {
  /** Visual treatment. Hero is used for entity-detail pages with a title. */
  variant?: "light" | "hero" | "hero-sub";

  /** Entity title shown in the hero variant (event name, club name, etc). */
  title?: string;

  /** Metadata line under the title in the hero variant. */
  meta?: string;

  /** Status pill in the hero variant (top-right of the title block). */
  status?: HeaderStatus;

  /** Back link: label (line 1) plus optional subtitle (line 2 — used by
   * deeply-nested sub-pages to show the league/round on top of the
   * specific match). */
  back?: { label: string; href?: string; onClick?: () => void; subtitle?: string };

  /** Primary action rendered in the header's right slot (hero-sub only). */
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
    icon?: ReactNode;
  };

  /** Show the small admin pill to the right of the logo (light variant). */
  isAdmin?: boolean;

  /** Notification count for the bell badge. 0/undefined hides the badge. */
  notifications?: number;

  /** Avatar initial + href for the avatar menu. */
  user?: { initial: string; avatarUrl?: string; href?: string };

  /** When set, render an "Invite a friend to the app" icon button in
   * the header's right-hand action row (next to the bell). Called on
   * tap. The parent typically opens a share modal. */
  onInvite?: () => void;

  /** Single-letter type badge overlaid on the share icon ("E" event,
   *  "C" club, "L" league, "T" team, "M" match-day, …). Tells the user
   *  at a glance WHAT the share will share. */
  inviteKind?: string;
  /** Long-form label used in aria-label / tooltip (e.g. "Share event"). */
  inviteLabel?: string;

  /** When set, render a "Share match-day schedule" button — the trophy
   *  glyph from BottomNav, distinct from the invite share. Audience is
   *  the existing WhatsApp group; payload is the full schedule. */
  onShareSchedule?: () => void;
  /** Long-form label used in aria-label / tooltip for the schedule
   *  share (e.g. "Share match-day schedule"). */
  shareScheduleLabel?: string;
}

export function AppHeader({
  variant = "light",
  title,
  meta,
  status,
  back,
  action,
  isAdmin,
  notifications,
  user,
  onInvite,
  inviteKind,
  inviteLabel,
  onShareSchedule,
  shareScheduleLabel,
}: AppHeaderProps) {
  if (variant === "hero-sub") {
    return <HeroSubHeader {...{ title, meta, back, action, notifications, user, onInvite, inviteKind, inviteLabel, onShareSchedule, shareScheduleLabel }} />;
  }
  return variant === "hero" ? (
    <HeroHeader {...{ title, meta, status, back, notifications, user, onInvite, inviteKind, inviteLabel, onShareSchedule, shareScheduleLabel }} />
  ) : (
    <LightHeader {...{ back, title, isAdmin, notifications, user, onInvite, inviteKind, inviteLabel, onShareSchedule, shareScheduleLabel }} />
  );
}
export default AppHeader;

/* ────────────────────────────────────────────────────────────────
   Shared fragments
   ──────────────────────────────────────────────────────────────── */

// Thin wrapper over the canonical BackButton — keeps the hero/light call sites
// unchanged while the markup lives in one place. `color` themes it for the
// dark gradient (white) or light header (action colour).
function BackChevron(props: {
  href?: string;
  label: string;
  subtitle?: string;
  color: string;
  onClick?: () => void;
}) {
  return <BackButton {...props} />;
}

/** Entity title that auto-shrinks to fit a single line, down to `min`px; only
 *  if even the floor overflows does it wrap (rather than clip). Keeps long
 *  names like "I Liga Interclubes … Zona Centro - Portugal" on one row when it
 *  can. */
function HeroTitle({
  text,
  max,
  min,
  color = "#fff",
}: {
  text: string;
  max: number;
  min: number;
  color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.whiteSpace = "nowrap";
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && el.scrollWidth > el.clientWidth) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      // Even at the floor it won't fit — wrap instead of clipping.
      el.style.whiteSpace = el.scrollWidth > el.clientWidth ? "normal" : "nowrap";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, max, min]);
  return (
    <div
      ref={ref}
      style={{
        fontSize: max,
        fontWeight: 800,
        letterSpacing: "-0.02em",
        lineHeight: 1.1,
        color,
        overflow: "hidden",
      }}
    >
      {text}
    </div>
  );
}

function HeaderActions({
  color,
  avatarBg,
  badge,
  user,
  onInvite,
  inviteKind,
  inviteLabel,
  onShareSchedule,
  shareScheduleLabel,
}: {
  color: string;
  avatarBg: string;
  badge?: number;
  user?: { initial: string; avatarUrl?: string; href?: string };
  onInvite?: () => void;
  /** Single-letter type badge overlaid on the share icon ("E" event,
   *  "C" club, "L" league, "T" team, "M" match-day, …). Tells the user
   *  at a glance WHAT the share will share. */
  inviteKind?: string;
  /** Long-form label used in aria-label/title (e.g. "Share event"). */
  inviteLabel?: string;
  /** When set, render a separate trophy-glyph button for sharing the
   *  match-day schedule. */
  onShareSchedule?: () => void;
  shareScheduleLabel?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {onInvite && (
        <button
          type="button"
          onClick={onInvite}
          aria-label={inviteLabel || "Invite a friend to FriendlyBall"}
          title={inviteLabel || "Invite a friend"}
          style={{ position: "relative", background: "transparent", border: 0, padding: 0, cursor: "pointer", lineHeight: 0 }}
        >
          {/* Share-arrow + plus icon: distinct from the bell. */}
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="6" cy="12" r="2.4" stroke={color} strokeWidth={1.8} />
            <circle cx="17" cy="6" r="2.4" stroke={color} strokeWidth={1.8} />
            <circle cx="17" cy="18" r="2.4" stroke={color} strokeWidth={1.8} />
            <path d="M8 11l7-4M8 13l7 4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          </svg>
          {inviteKind && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                bottom: -4,
                right: -6,
                minWidth: 14,
                height: 14,
                padding: "0 3px",
                background: color,
                color: avatarBg,
                borderRadius: 3,
                fontSize: 9,
                fontWeight: 800,
                lineHeight: "14px",
                textAlign: "center",
                letterSpacing: "0.02em",
              }}
            >{inviteKind}</span>
          )}
        </button>
      )}
      {onShareSchedule && (
        <button
          type="button"
          onClick={onShareSchedule}
          aria-label={shareScheduleLabel || "Share match-day schedule"}
          title={shareScheduleLabel || "Share match-day schedule"}
          style={{ position: "relative", background: "transparent", border: 0, padding: 0, cursor: "pointer", lineHeight: 0 }}
        >
          {/* Megaphone — "broadcast schedule to the squad". Stroke-only
              line-art so it picks up the header's `color` (white on
              hero, slate on light) like the invite share icon. */}
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 10v4l11 5V5L4 10z"
              stroke={color}
              strokeWidth={1.8}
              strokeLinejoin="round"
            />
            <path
              d="M4 10H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1"
              stroke={color}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M7 14v3a2 2 0 0 0 4 0v-2"
              stroke={color}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M18 8c1.2 1 1.2 7 0 8"
              stroke={color}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <Link
        href="/notifications"
        style={{ position: "relative", lineHeight: 0 }}
        aria-label="Notifications"
      >
        {(() => {
          const hasUnread = !!badge && badge > 0;
          // Unread → filled bell. All read → outline bell.
          return hasUnread ? (
            <svg width={22} height={22} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round">
              <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" />
              <path d="M10 21a2 2 0 004 0" fill="none" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          ) : (
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 21a2 2 0 004 0" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          );
        })()}
        {!!badge && badge > 0 && (
          <span
            style={{
              position: "absolute",
              top: -3,
              right: -4,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 9999,
              background: "#ef4444",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1.5px solid #fff",
            }}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </Link>
      <Link
        href={user?.href ?? "/profile"}
        aria-label="Profile"
        style={{
          width: 30,
          height: 30,
          borderRadius: 9999,
          background: avatarBg,
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        {user?.initial ?? "?"}
      </Link>
    </div>
  );
}

function AdminPill({ variant }: { variant: "light" | "dark" | "ghost" }) {
  const s = {
    light: { bg: "#dcfce7", fg: "#15803d", border: "transparent" },
    dark:  { bg: "rgba(255,255,255,0.14)", fg: "#fff", border: "rgba(255,255,255,0.3)" },
    ghost: { bg: "transparent", fg: "#15803d", border: "#bbf7d0" },
  }[variant];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 9999,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        textTransform: "uppercase",
      }}
    >
      <svg width={10} height={10} viewBox="0 0 10 10">
        <path
          d="M5 1 L7 4 L9 4.5 L7 6 L7.5 9 L5 7.5 L2.5 9 L3 6 L1 4.5 L3 4 Z"
          fill={s.fg}
        />
      </svg>
      Admin
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────
   Light variant — list & tab pages
   ──────────────────────────────────────────────────────────────── */

function LightHeader({
  back,
  title,
  isAdmin,
  notifications,
  user,
  onInvite,
  inviteKind,
  inviteLabel,
  onShareSchedule,
  shareScheduleLabel,
}: Pick<AppHeaderProps, "back" | "title" | "isAdmin" | "notifications" | "user" | "onInvite" | "inviteKind" | "inviteLabel" | "onShareSchedule" | "shareScheduleLabel">) {
  const hasBack = !!back;
  const ref = useRef<HTMLElement | null>(null);
  useHeaderHeightSync(ref);
  return (
    <header
      ref={ref}
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          height: 48,
          boxSizing: "border-box",
        }}
      >
        {/* Back link on the top row, opposite the actions — same slot as the
            green hero so the back link is always in the identical position.
            (Logo lives in the footer strip under BottomNav.) */}
        {hasBack ? (
          <BackChevron {...back!} color="#16a34a" />
        ) : (
          <div />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isAdmin && <AdminPill variant="light" />}
          <HeaderActions
            color="#334155"
            avatarBg="#16a34a"
            badge={notifications}
            user={user}
            onInvite={onInvite}
            inviteKind={inviteKind}
            inviteLabel={inviteLabel}
            onShareSchedule={onShareSchedule}
            shareScheduleLabel={shareScheduleLabel}
          />
        </div>
      </div>
      {title && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px 12px",
          }}
        >
          <div
            style={{
              color: "#0f172a",
              fontSize: 15,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
        </div>
      )}
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────
   Hero variant — entity detail pages
   ──────────────────────────────────────────────────────────────── */

function HeroHeader({
  title,
  meta,
  status,
  back,
  notifications,
  user,
  onInvite,
  inviteKind,
  inviteLabel,
  onShareSchedule,
  shareScheduleLabel,
}: Pick<AppHeaderProps, "title" | "meta" | "status" | "back" | "notifications" | "user" | "onInvite" | "inviteKind" | "inviteLabel" | "onShareSchedule" | "shareScheduleLabel">) {
  const statusStyles: Record<HeaderStatus, { bg: string; fg: string; dot: string }> = {
    draft:     { bg: "rgba(255,255,255,0.18)", fg: "#fff",     dot: "#fde68a" },
    open:      { bg: "rgba(255,255,255,0.18)", fg: "#fff",     dot: "#bef264" },
    active:    { bg: "#bef264",                 fg: "#14532d",  dot: "#15803d" },
    completed: { bg: "rgba(255,255,255,0.12)", fg: "rgba(255,255,255,0.75)", dot: "rgba(255,255,255,0.55)" },
  };
  const s = status ? statusStyles[status] : undefined;
  const ref = useRef<HTMLElement | null>(null);
  useHeaderHeightSync(ref);

  return (
    <header
      ref={ref}
      style={{
        background: "linear-gradient(180deg, #15803d 0%, #14532d 100%)",
        color: "#fff",
        paddingBottom: 18,
        paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          height: 48,
          boxSizing: "border-box",
        }}
      >
        {/* Back link sits on the top row, opposite the action icons
            (logo lives in the footer strip under BottomNav). */}
        {back ? (
          <BackChevron href={back.href} label={back.label} onClick={back.onClick} color="#d9f99d" />
        ) : (
          <div />
        )}
        <HeaderActions
          color="#fff"
          avatarBg="#14532d"
          badge={notifications}
          user={user}
          onInvite={onInvite}
          inviteKind={inviteKind}
          inviteLabel={inviteLabel}
          onShareSchedule={onShareSchedule}
          shareScheduleLabel={shareScheduleLabel}
        />
      </div>
      {title && (
        <div style={{ padding: "8px 16px 0" }}>
          <HeroTitle text={title} max={24} min={15} />
          {(meta || s) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginTop: 8,
              }}
            >
              {meta ? (
                <div
                  style={{
                    fontSize: 13,
                    color: "rgba(255,255,255,0.82)",
                    fontWeight: 500,
                    lineHeight: 1.35,
                    minWidth: 0,
                  }}
                >
                  {meta}
                </div>
              ) : (
                <span />
              )}
              {s && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px 4px 8px",
                    borderRadius: 9999,
                    background: s.bg,
                    color: s.fg,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 9999,
                      background: s.dot,
                    }}
                  />
                  {status}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────
   Hero-sub variant — nested sub-pages (Players, Pairing, etc.)
   ──────────────────────────────────────────────────────────────── */

function HeroSubHeader({
  title,
  meta,
  back,
  action,
  notifications,
  user,
  onInvite,
  inviteKind,
  inviteLabel,
  onShareSchedule,
  shareScheduleLabel,
}: Pick<AppHeaderProps, "title" | "meta" | "back" | "action" | "notifications" | "user" | "onInvite" | "inviteKind" | "inviteLabel" | "onShareSchedule" | "shareScheduleLabel">) {
  const actionEl = action ? (
    action.onClick ? (
      <button
        type="button"
        onClick={action.onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderRadius: 9999,
          background: "#fff",
          color: "#15803d",
          fontSize: 13,
          fontWeight: 700,
          border: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {action.icon}
        {action.label}
      </button>
    ) : (
      <Link
        href={action.href ?? "#"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderRadius: 9999,
          background: "#fff",
          color: "#15803d",
          fontSize: 13,
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {action.icon}
        {action.label}
      </Link>
    )
  ) : null;

  const ref = useRef<HTMLElement | null>(null);
  useHeaderHeightSync(ref);

  // The prominent line for a sub-page is its section label (meta, e.g.
  // "Pairing" / "Matches" / "Participants"); fall back to title for sub-headers
  // that pass only a title (e.g. "Sign-up", or the loading header).
  const heading = meta ?? title;

  return (
    <header
      ref={ref}
      style={{
        background: "linear-gradient(180deg, #15803d 0%, #14532d 100%)",
        color: "#fff",
        paddingBottom: 14,
        paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          height: 48,
          boxSizing: "border-box",
        }}
      >
        {/* Back link on the top row, opposite the icons — pixel-identical to
            the full hero so it's always in the same spot (logo lives in the
            footer strip under BottomNav). */}
        {back ? (
          <BackChevron href={back.href} label={back.label} subtitle={back.subtitle} onClick={back.onClick} color="#d9f99d" />
        ) : (
          <div />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {actionEl}
          <HeaderActions
            color="#fff"
            avatarBg="#14532d"
            badge={notifications}
            user={user}
            onInvite={onInvite}
            inviteKind={inviteKind}
            inviteLabel={inviteLabel}
            onShareSchedule={onShareSchedule}
            shareScheduleLabel={shareScheduleLabel}
          />
        </div>
      </div>
      {heading && (
        <div style={{ padding: "8px 16px 0" }}>
          <HeroTitle text={heading} max={20} min={14} />
        </div>
      )}
    </header>
  );
}
