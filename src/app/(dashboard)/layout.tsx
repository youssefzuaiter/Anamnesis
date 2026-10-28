import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireUserId } from "@/lib/session";
import { CommandPalette } from "@/components/command-palette";
import { AppSidebar } from "@/components/app-sidebar";
import { BrandLockup } from "@/components/brand";
import { MobileNav } from "@/components/mobile-nav";
import { ShortcutsProvider } from "@/components/shortcuts-provider";
import {
  AssistantDockProvider,
  AssistantPanel,
  AssistantToggle,
} from "@/components/assistant-dock";
import { countDueBy } from "@/repositories/task-repository";
import { countDue } from "@/repositories/flashcard-repository";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = await requireUserId();

  const displayName = session.user.name ?? session.user.email ?? "Account";
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const [tasks, cards] = await Promise.all([
    countDueBy(userId, endOfToday),
    countDue(userId, now),
  ]);
  const badges = { tasks, cards };

  return (
    <AssistantDockProvider>
      <ShortcutsProvider>
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-surface px-3 py-2 text-sm font-semibold text-text focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-1">
          <AppSidebar displayName={displayName} badges={badges} />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex min-h-14 items-center justify-between gap-3 px-4 sm:justify-end sm:px-8">
              <Link href="/" aria-label="Anamnesis, go to Today" className="sm:hidden">
                <BrandLockup height={40} />
              </Link>
              <div className="hidden sm:block">
                <AssistantToggle variant="bar" />
              </div>
            </header>
            {/* min-w-0 lets this flex item shrink below its content width; without it
                an overflow-x-auto child cannot clip and the whole page scrolls. The
                bottom padding on a phone clears the fixed tab bar. */}
            <main
              id="main"
              className="min-w-0 flex-1 px-4 pb-32 pt-2 sm:px-8 sm:pb-12 lg:px-10"
            >
              {children}
            </main>
          </div>

          <AssistantPanel />
        </div>
        <AssistantToggle variant="fab" />
        <MobileNav badges={badges} />
        <CommandPalette />
      </ShortcutsProvider>
    </AssistantDockProvider>
  );
}
