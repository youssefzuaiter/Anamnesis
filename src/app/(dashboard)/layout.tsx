import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { CommandPalette } from "@/components/command-palette";
import { CommandPaletteTrigger } from "@/components/command-palette-trigger";
import { dotClass, type Hue } from "@/lib/card-color";

// Extended as each section of the spec's directory map is actually built;
// unbuilt routes are deliberately absent rather than linked as dead ends.
const NAV_ITEMS: { href: string; label: string; hue: Hue }[] = [
  { href: "/", label: "Dashboard", hue: "blue" },
  { href: "/notes", label: "Notes", hue: "purple" },
  { href: "/tasks", label: "Tasks", hue: "rose" },
  { href: "/calendar", label: "Calendar", hue: "gold" },
  { href: "/goals", label: "Goals", hue: "gold" },
  { href: "/projects", label: "Projects", hue: "green" },
  { href: "/courses", label: "Courses", hue: "peach" },
  { href: "/search", label: "Search", hue: "blue" },
  { href: "/review", label: "Review", hue: "green" },
  { href: "/cards", label: "Cards", hue: "gold" },
  { href: "/ai", label: "Assistant", hue: "peach" },
  { href: "/focus", label: "Focus", hue: "blue" },
  { href: "/trash", label: "Trash", hue: "rose" },
  { href: "/audit", label: "Audit", hue: "purple" },
  { href: "/settings", label: "Settings", hue: "blue" },
];

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const displayName = session.user.name ?? session.user.email ?? "Account";

  return (
    <div className="flex flex-1 flex-col sm:flex-row">
      {/* The sidebar is desktop-only, so without this bar a phone has no way to
          navigate at all. Horizontal scroll rather than a drawer keeps it
          stateless — no client component, no open/closed state to manage. */}
      <header className="border-b border-border-subtle bg-surface sm:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-serif text-lg font-bold tracking-tight text-text">
            Nexus
          </span>
          <SignOutButton className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-60" />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-2 rounded-full border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${dotClass(item.hue)}`}
                aria-hidden
              />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-border-subtle bg-surface px-3 py-5 sm:flex">
        <div className="mb-6 px-2 font-serif text-lg font-bold tracking-tight text-text">
          Nexus
        </div>

        <CommandPaletteTrigger />

        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${dotClass(item.hue)}`}
                aria-hidden
              />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto border-t border-border-subtle pt-3">
          <p className="truncate px-3 pb-1 text-xs text-text-faint">
            {displayName}
          </p>
          <a
            href="/api/export"
            className="block rounded-lg px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
          >
            Export my data
          </a>
          <SignOutButton />
        </div>
      </aside>

      {/* min-w-0 lets this flex item shrink below its content width; without it
          an overflow-x-auto child cannot clip and the whole page scrolls. */}
      <main className="min-w-0 flex-1 px-6 py-8 sm:px-10">{children}</main>

      <CommandPalette />
    </div>
  );
}
