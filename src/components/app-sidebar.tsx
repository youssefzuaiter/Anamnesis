"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { CommandPaletteTrigger } from "@/components/command-palette-trigger";
import { SignOutButton } from "@/components/sign-out-button";
import { NAV_GROUPS, isActive, type NavBadges } from "@/components/nav-items";

export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent ${className}`}
    >
      <Icon name="mark" className="size-4" strokeWidth={2.25} />
    </span>
  );
}

function initials(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function AppSidebar({
  displayName,
  badges,
}: {
  displayName: string;
  badges: NavBadges;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-surface-subtle px-3 pb-3 pt-4 sm:flex">
      <Link href="/" className="flex items-center gap-2.5 rounded-lg px-1.5 py-0.5">
        <BrandMark />
        <span className="text-[17px] font-bold tracking-tight text-text">Anamnesis</span>
      </Link>

      <CommandPaletteTrigger />

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "home"} className="flex flex-col gap-0.5">
            {group.label && (
              <p className="px-2.5 pb-1 text-xs font-semibold text-text-faint">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const badge = item.badge ? badges[item.badge] : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
                    active
                      ? "bg-accent-soft font-semibold text-accent-ink"
                      : "font-medium text-text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {badge > 0 && (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full border border-border-strong bg-surface px-1.5 text-xs font-semibold tabular-nums text-text-muted">
                      {badge}
                      <span className="sr-only"> due</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border-subtle pt-3">
        <div className="flex items-center gap-2.5 px-1.5 pb-2">
          <span
            aria-hidden="true"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink"
          >
            {initials(displayName)}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold text-text">
            {displayName}
          </span>
        </div>
        <a
          href="/api/export"
          className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <Icon name="export" />
          Export my data
        </a>
        <SignOutButton />
      </div>
    </aside>
  );
}
