import type { IconName } from "@/components/icons";

export type NavBadges = { tasks: number; cards: number };

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  badge?: keyof NavBadges;
};

export type NavGroup = { label: string | null; items: NavItem[] };

// Grouped by what you are doing rather than listed flat: fifteen undifferentiated
// links were the old sidebar's main problem. The assistant is not here; it is
// a panel on every screen (⌘J), and its history page is linked from that panel.
// Unbuilt routes are deliberately absent rather than linked as dead ends.
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ href: "/", label: "Today", icon: "today" }] },
  {
    label: "Capture and recall",
    items: [
      { href: "/notes", label: "Notes", icon: "notes" },
      { href: "/search", label: "Search", icon: "search" },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/tasks", label: "Tasks", icon: "tasks", badge: "tasks" },
      { href: "/calendar", label: "Calendar", icon: "calendar" },
      { href: "/projects", label: "Projects", icon: "projects" },
      { href: "/goals", label: "Goals", icon: "goals" },
    ],
  },
  {
    label: "Study",
    items: [
      { href: "/courses", label: "Courses", icon: "courses" },
      { href: "/cards", label: "Cards", icon: "cards", badge: "cards" },
      { href: "/review", label: "Review", icon: "review" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/focus", label: "Focus", icon: "focus" },
      { href: "/audit", label: "Audit trail", icon: "audit" },
      { href: "/trash", label: "Trash", icon: "trash" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

/** The phone's bottom bar: five slots at most, the rest live under More. */
export const MOBILE_TABS: NavItem[] = [
  { href: "/", label: "Today", icon: "today" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/tasks", label: "Tasks", icon: "tasks", badge: "tasks" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
];

export const MOBILE_MORE: NavItem[] = [
  { href: "/ai", label: "Assistant", icon: "assistant" },
  ...NAV_GROUPS.flatMap((group) => group.items).filter(
    (item) => !MOBILE_TABS.some((tab) => tab.href === item.href),
  ),
];

/** `/` is only active on itself; every other section owns its subpaths. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
