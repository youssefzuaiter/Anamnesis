// Areas (ROADMAP item 56): which parts of life an account keeps, School, Work or both. Pure rules, no Prisma.
//
// One app and one database. An area decides what the menu shows and, when both are on, lets Today be looked at one area at a time. It never
// changes or deletes anything: a task or event is School when it has a course (or a University project), Work when it sits under a Work or
// Career project, and belongs to neither otherwise, in which case a filter never hides it.

import { NAV_GROUPS, MOBILE_MORE, type NavGroup, type NavItem } from "@/components/nav-items";

export const AREA_SETTINGS = ["school", "work", "both"] as const;
export type Areas = (typeof AREA_SETTINGS)[number];
export type Area = "school" | "work";
export type AreaFilter = "all" | Area;

/** The stored value, School unless it is exactly one of the three (the default for an account that never chose, and for anything unreadable). */
export function parseAreas(raw: unknown): Areas {
  return raw === "work" || raw === "both" ? raw : "school";
}

/** A project's category as an area: University is School, Work and Career are Work, anything else is neither. */
export function categoryArea(category: string): Area | null {
  if (category === "University") return "school";
  if (category === "Work" || category === "Career") return "work";
  return null;
}

export function areaOf(
  item: { courseId: string | null; projectId: string | null },
  categories: ReadonlyMap<string, string>,
): Area | null {
  if (item.courseId) return "school";
  if (item.projectId) {
    const category = categories.get(item.projectId);
    if (category !== undefined) return categoryArea(category);
  }
  return null;
}

/** The `?area=` value, honoured only when both areas are on and it is exactly "school" or "work". */
export function parseAreaFilter(raw: unknown, areas: Areas): AreaFilter {
  if (areas !== "both") return "all";
  return raw === "school" || raw === "work" ? raw : "all";
}

export function keepForFilter(area: Area | null, filter: AreaFilter): boolean {
  return filter === "all" || area === null || area === filter;
}

const STUDY_ONLY = new Set(["/courses", "/cards", "/review", "/stats"]);
const visible = (item: NavItem, areas: Areas) => areas !== "work" || !STUDY_ONLY.has(item.href);

/** The sidebar: with School off, Courses, Cards, Review and Stats are hidden (the pages still open by address). */
export function navGroupsFor(areas: Areas): NavGroup[] {
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => visible(item, areas)) })).filter((group) => group.items.length > 0);
}

export function mobileMoreFor(areas: Areas): NavItem[] {
  return MOBILE_MORE.filter((item) => visible(item, areas));
}
