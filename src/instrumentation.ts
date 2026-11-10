// Runs once when a Next.js server starts (see node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
// The one thing started here is the reminder scheduler, and only in the Node.js runtime: the Edge runtime
// has no database driver and no timers that outlive a request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startReminderScheduler } = await import("@/services/reminder-scheduler");
  startReminderScheduler();
}
