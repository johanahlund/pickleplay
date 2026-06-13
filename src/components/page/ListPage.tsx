"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { frameClass } from "@/components/Card";
import { LoadingState } from "@/components/LoadingState";
import { useHeaderTitle } from "@/components/HeaderBack";

/**
 * LIST archetype primitives.
 *
 * A list screen = a titled header (with an optional +action) over a vertical
 * stack of tappable cards, plus standard loading / empty states. Use these so
 * every list page shares one header pattern, one card padding, and one gap —
 * instead of each page hand-rolling `space-y-4` / `space-y-2` / `frameClass p-3|p-4`.
 *
 *   <ListPage
 *     title="Leagues"
 *     action={{ label: "+ League", href: "/leagues/new" }}
 *     loading={loading}
 *     isEmpty={!leagues.length}
 *     emptyLabel="No leagues yet"
 *   >
 *     <List>
 *       {leagues.map((l) => (
 *         <ListItem key={l.id} href={`/leagues/${l.id}`}>…</ListItem>
 *       ))}
 *     </List>
 *   </ListPage>
 *
 * `action` accepts either a `{ label, href|onClick }` (rendered as the standard
 * outline action button) or an arbitrary node for bespoke header controls.
 * `filters` renders between the header and the list (search/filter blocks) and
 * stays visible in the empty state.
 */

type Action = { label: string; href?: string; onClick?: () => void };

export function ListPage({
  title,
  count,
  action,
  filters,
  loading,
  loadingLabel = "Loading…",
  isEmpty,
  emptyLabel = "Nothing here yet",
  children,
}: {
  title: ReactNode;
  count?: number;
  action?: Action | ReactNode;
  filters?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  isEmpty?: boolean;
  emptyLabel?: string;
  children?: ReactNode;
}) {
  // Main lists have no back button — their title goes in the global header's
  // top-left slot. String titles only; non-string titles stay in the body.
  const headerTitle = typeof title === "string" ? (count != null ? `${title} ${count}` : title) : null;
  useHeaderTitle(headerTitle);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {headerTitle ? (
          <div />
        ) : (
          <h2 className="text-xl font-bold">
            {title}
            {count != null && <span className="ml-2 text-sm font-medium text-muted">{count}</span>}
          </h2>
        )}
        {isAction(action) ? <ActionButton {...action} /> : action}
      </div>
      {filters}
      {loading ? (
        <LoadingState label={loadingLabel} />
      ) : isEmpty ? (
        <div className="text-center py-12">
          <p className="text-muted text-sm">{emptyLabel}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function isAction(a: Action | ReactNode): a is Action {
  return !!a && typeof a === "object" && "label" in (a as object);
}

const actionCls =
  "text-action border border-action/30 px-4 py-2 rounded-lg font-medium text-sm " +
  "hover:bg-action/5 active:bg-action/10 transition-colors";

function ActionButton({ label, href, onClick }: Action) {
  if (href) {
    return (
      <Link href={href} className={actionCls}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={actionCls}>
      {label}
    </button>
  );
}

/** Vertical stack of list rows with the standard 8px gap. */
export function List({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-2 ${className}`}>{children}</div>;
}

/** One tappable card row — standard frame + p-4. Pass `href` OR `onClick`. */
export function ListItem({
  href,
  onClick,
  className = "",
  children,
}: {
  href?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const cls = `block ${frameClass} p-4 active:bg-gray-50 transition-colors ${className}`;
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <div onClick={onClick} className={cls}>
      {children}
    </div>
  );
}
