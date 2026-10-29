"use client";

import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared empty state for desktop modules.
 *
 * Several desktop views rendered nothing at all when a list came back empty, which
 * reads as "still loading" or "broken". This gives every module the same shape:
 * what happened, why it is fine, and the one action that moves forward.
 */
export function DesktopEmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="desktop-empty-state" role="status">
      <span className="desktop-empty-state__icon" aria-hidden="true">
        <Icon />
      </span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="desktop-empty-state__action">{action}</div> : null}
    </div>
  );
}
