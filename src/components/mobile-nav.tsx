"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeSwitch } from "@/components/theme-switch";
import {
  MOBILE_MORE,
  MOBILE_TABS,
  isActive,
  type NavBadges,
} from "@/components/nav-items";

const TAB_CLASS =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors";

/**
 * The phone's navigation: four destinations and More, at the bottom where a
 * thumb reaches. More opens a native <dialog> as a bottom sheet, so focus
 * trapping, Escape and the backdrop come from the browser rather than from
 * hand-written state.
 */
export function MobileNav({ badges }: { badges: NavBadges }) {
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const moreActive = MOBILE_MORE.some((item) => isActive(pathname, item.href));
  const close = () => sheet.current?.close();

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border-subtle bg-surface px-1 pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {MOBILE_TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          const badge = tab.badge ? badges[tab.badge] : 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`${TAB_CLASS} ${active ? "text-accent-ink" : "text-text-faint"}`}
            >
              <span className="relative">
                <Icon name={tab.icon} className="size-[22px]" />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-4 text-on-accent">
                    {badge}
                    <span className="sr-only"> due</span>
                  </span>
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => sheet.current?.showModal()}
          className={`${TAB_CLASS} ${moreActive ? "text-accent-ink" : "text-text-faint"}`}
        >
          <Icon name="more" className="size-[22px]" strokeWidth={2.5} />
          More
        </button>
      </nav>

      <dialog
        ref={sheet}
        aria-labelledby="more-title"
        onClick={(event) => {
          // A click that lands on the <dialog> itself is on the backdrop.
          if (event.target === event.currentTarget) close();
        }}
        className="mx-0 mb-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-2xl bg-surface p-0 text-text backdrop:bg-black/50"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 id="more-title" className="text-base font-bold">
            More
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-xl text-text-muted hover:bg-surface-subtle"
          >
            <Icon name="close" />
          </button>
        </div>
        <ul className="grid grid-cols-2 gap-1 px-3 pb-3">
          {MOBILE_MORE.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${
                    active ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-subtle"
                  }`}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-0.5 border-t border-border-subtle px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <ThemeSwitch className="mb-2 w-full" />
          <a
            href="/api/export"
            className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-surface-subtle"
          >
            <Icon name="export" />
            Export my data
          </a>
          <SignOutButton className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-text-muted hover:bg-surface-subtle disabled:opacity-60" />
        </div>
      </dialog>
    </>
  );
}
