// src/components/AppHeader.tsx

"use client";

import React, { type ReactNode } from "react";
import Link from "next/link";
import Logo from "./Logo";

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

  /** Back link: label + href. Omit to hide. */
  back?: { label: string; href: string; onClick?: () => void };

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
}: AppHeaderProps) {
  if (variant === "hero-sub") {
    return <HeroSubHeader {...{ title, meta, back, action, notifications, user }} />;
  }
  return variant === "hero" ? (
    <HeroHeader {...{ title, meta, status, back, notifications, user }} />
  ) : (
    <LightHeader {...{ back, title, isAdmin, notifications, user }} />
  );
}
export default AppHeader;

/* ────────────────────────────────────────────────────────────────
   Shared fragments
   ──────────────────────────────────────────────────────────────── */

function BackChevron({
  href,
  label,
  color,
  onClick,
}: {
  href: string;
  label: string;
  color: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <svg width={10} height={16} viewBox="0 0 10 16" style={{ marginTop: 1 }}>
        <path
          d="M8 2 L2 8 L8 14"
          fill="none"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </>
  );
  const sharedStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 15,
    fontWeight: 500,
    color,
    textDecoration: "none",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  };

  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={sharedStyle}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href} style={sharedStyle}>
      {inner}
    </Link>
  );
}

function HeaderActions({
  color,
  avatarBg,
  badge,
  user,
}: {
  color: string;
  avatarBg: string;
  badge?: number;
  user?: { initial: string; avatarUrl?: string; href?: string };
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Link
        href="/notifications"
        style={{ position: "relative", lineHeight: 0 }}
        aria-label="Notifications"
      >
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <path
            d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 21a2 2 0 004 0"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </svg>
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
}: Pick<AppHeaderProps, "back" | "title" | "isAdmin" | "notifications" | "user">) {
  const hasBack = !!back;
  return (
    <header
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        position: "sticky",
        top: 0,
        zIndex: 40,
        paddingTop: "env(safe-area-inset-top, 0px)",
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
        <Logo size={20} color="#15803d" ball="pickle" ballAlign="midline" />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isAdmin && <AdminPill variant="light" />}
          <HeaderActions
            color="#334155"
            avatarBg="#16a34a"
            badge={notifications}
            user={user}
          />
        </div>
      </div>
      {(hasBack || title) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px 12px",
          }}
        >
          {hasBack && <BackChevron {...back!} color="#16a34a" />}
          {hasBack && title && (
            <div style={{ width: 1, height: 14, background: "#cbd5e1" }} />
          )}
          {title && (
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
          )}
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
}: Pick<AppHeaderProps, "title" | "meta" | "status" | "back" | "notifications" | "user">) {
  const statusStyles: Record<HeaderStatus, { bg: string; fg: string; dot: string }> = {
    draft:     { bg: "rgba(255,255,255,0.18)", fg: "#fff",     dot: "#fde68a" },
    open:      { bg: "rgba(255,255,255,0.18)", fg: "#fff",     dot: "#bef264" },
    active:    { bg: "#bef264",                 fg: "#14532d",  dot: "#15803d" },
    completed: { bg: "rgba(255,255,255,0.12)", fg: "rgba(255,255,255,0.75)", dot: "rgba(255,255,255,0.55)" },
  };
  const s = status ? statusStyles[status] : undefined;

  return (
    <header
      style={{
        background: "linear-gradient(180deg, #15803d 0%, #14532d 100%)",
        color: "#fff",
        paddingBottom: 18,
        paddingTop: "env(safe-area-inset-top, 0px)",
        position: "sticky",
        top: 0,
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
        <Logo size={20} color="#fff" ball="pickle" ballAlign="midline" />
        <HeaderActions
          color="#fff"
          avatarBg="rgba(255,255,255,0.22)"
          badge={notifications}
          user={user}
        />
      </div>
      {back && (
        <div style={{ padding: "2px 16px 0" }}>
          <BackChevron href={back.href} label={back.label} onClick={back.onClick} color="rgba(255,255,255,0.72)" />
        </div>
      )}
      {title && (
        <div style={{ padding: "10px 16px 0", position: "relative" }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              paddingRight: 72,
            }}
          >
            {title}
          </div>
          {s && (
            <div
              style={{
                position: "absolute",
                top: 12,
                right: 16,
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
          {meta && (
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.82)",
                fontWeight: 500,
                marginTop: 8,
                lineHeight: 1.35,
              }}
            >
              {meta}
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
}: Pick<AppHeaderProps, "title" | "meta" | "back" | "action" | "notifications" | "user">) {
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

  return (
    <header
      style={{
        background: "linear-gradient(180deg, #15803d 0%, #14532d 100%)",
        color: "#fff",
        paddingBottom: 14,
        paddingTop: "env(safe-area-inset-top, 0px)",
        position: "sticky",
        top: 0,
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
        <Logo size={20} color="#fff" ball="pickle" ballAlign="midline" />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {actionEl}
          <HeaderActions
            color="#fff"
            avatarBg="rgba(255,255,255,0.22)"
            badge={notifications}
            user={user}
          />
        </div>
      </div>
      {back && (
        <div style={{ padding: "2px 16px 0" }}>
          <BackChevron href={back.href} label={back.label} onClick={back.onClick} color="rgba(255,255,255,0.85)" />
        </div>
      )}
      {title && (
        <div style={{ padding: "6px 16px 0" }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            {title}
          </div>
          {meta && (
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.75)",
                fontWeight: 500,
                marginTop: 4,
                lineHeight: 1.35,
              }}
            >
              {meta}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
