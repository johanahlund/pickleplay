"use client";

import type { ReactNode } from "react";
import { frameClass } from "@/components/Card";
import { useHeaderBack } from "@/components/HeaderBack";

/**
 * EDIT / CREATE archetype.
 *
 * Hierarchical back ("up" to the parent — never history), page title, an
 * optional context banner, then the form content (usually one or more
 * <FormCard> sections). Standardizes the wrapper that every create/edit page
 * currently hand-rolls.
 *
 *   <EditPage back={{ href: returnTo, label: "Back" }} title="Add Player">
 *     <FormCard>…fields…</FormCard>
 *   </EditPage>
 *
 * The back link is registered in the GLOBAL header's top-left slot (same
 * position as the green hero pages) via useHeaderBack — not rendered in-body.
 * Save/Cancel buttons live inside the form content (per the app's edit-UX
 * rule: Back always visible; Save/Cancel surfaced by the form itself).
 */
export function EditPage({
  back,
  title,
  banner,
  children,
}: {
  back: { href?: string; label: string; onClick?: () => void };
  title: ReactNode;
  banner?: ReactNode;
  children?: ReactNode;
}) {
  useHeaderBack(back);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {banner}
      {children}
    </div>
  );
}

/** Standard form panel — card frame, p-4, 12px vertical rhythm between fields. */
export function FormCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`${frameClass} p-4 space-y-3 ${className}`}>{children}</div>;
}
