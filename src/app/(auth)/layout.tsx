import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { BrandMark } from "@/components/app-sidebar";
import { Icon, type IconName } from "@/components/icons";

// Three things the app connects, drawn as the idea rather than a screenshot:
// the name means recollection, and recall here is a note, a plan and a date
// finding each other.
const CONNECTED: { icon: IconName; title: string; kind: string; position: string }[] = [
  { icon: "notes", title: "Backpropagation, intuition", kind: "Note", position: "left-[6%] top-[14%]" },
  { icon: "calendar", title: "ML midterm", kind: "Event · Tue 09:00", position: "left-[46%] top-[42%]" },
  { icon: "tasks", title: "Review week 6 slides", kind: "Task · due today", position: "left-[14%] top-[72%]" },
];

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getSessionUserId()) redirect("/");

  return (
    <main className="flex flex-1">
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="text-xl font-bold tracking-tight text-text">Anamnesis</span>
          </div>
          {children}
        </div>
      </div>

      <aside
        aria-hidden="true"
        className="hidden flex-1 flex-col justify-end gap-10 overflow-hidden bg-surface-subtle p-14 lg:flex"
      >
        <div className="relative mx-auto h-[360px] w-full max-w-[520px]">
          <svg
            viewBox="0 0 520 360"
            fill="none"
            className="absolute inset-0 size-full"
            stroke="var(--control)"
            strokeWidth="1.5"
            strokeDasharray="4 5"
          >
            <path d="M190 80 C 250 120 270 140 300 165" />
            <path d="M300 200 C 270 235 230 250 190 268" />
            <path d="M120 96 C 90 160 90 220 120 262" />
          </svg>
          {CONNECTED.map((item) => (
            <div
              key={item.title}
              className={`absolute flex items-center gap-2.5 rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 shadow-card ${item.position}`}
            >
              <Icon name={item.icon} className="size-[18px] text-text-faint" />
              <div>
                <p className="text-sm font-semibold text-text">{item.title}</p>
                <p className="text-xs text-text-faint">{item.kind}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="max-w-md">
          <p className="font-serif text-3xl italic text-text">anamnesis</p>
          <p className="mt-2 font-serif text-[17px] leading-relaxed text-text-muted">
            The recollection of what you already know. Your notes, tasks and
            calendar, connected and ready when you ask.
          </p>
        </div>
      </aside>
    </main>
  );
}
