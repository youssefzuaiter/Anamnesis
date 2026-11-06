// Amber means "needs attention", so it marks high priority and overdue; red is kept for destructive actions
// and errors. Shared by every place a task's priority word is drawn.
export const PRIORITY_STYLES: Record<string, string> = {
  high: "font-semibold text-warn",
  medium: "text-text-muted",
  low: "text-text-faint",
};
