import { requireUserId } from "@/lib/session";
import { getStudyTime } from "@/services/focus-service";
import { parseRange } from "@/lib/study-time";
import type { CognitiveLoad } from "@/lib/focus";
import { FocusSettings } from "@/components/focus-settings";
import { StudyByCourse } from "@/components/study-by-course";

export const metadata = { title: "Focus · Anamnesis" };

const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const LOAD_STYLE: Record<CognitiveLoad, string> = {
  light: "text-text-faint",
  steady: "text-text-muted",
  deep: "text-accent",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <p className="text-2xl font-semibold tabular-nums text-text">{value}</p>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
    </div>
  );
}

export default async function FocusPage({ searchParams }: PageProps<"/focus">) {
  const userId = await requireUserId();
  const params = await searchParams;
  // The range is a query string, so it is only ever one of three known values.
  const view = await getStudyTime(userId, parseRange(params.range), new Date());

  const codeOf = new Map(view.courses.map((course) => [course.id, course.code]));
  const { stats } = view;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Focus</h1>
        <p className="mt-1 text-sm text-text-muted">
          How long your writing and timer sessions run, and which course the time went to.
        </p>
      </header>

      <FocusSettings settings={view.settings} hasHistory={view.hasHistory} />

      {stats.sessions > 0 && (
        <section aria-label="Writing summary" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Writing sessions" value={String(stats.sessions)} />
          <Stat label="Minutes written" value={String(stats.totalMinutes)} />
          <Stat label="Average WPM" value={String(stats.averageWpm)} />
          <Stat label="Longest session" value={`${stats.longestMinutes}m`} />
        </section>
      )}

      <StudyByCourse view={view} />

      {view.recent.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-2 text-xs font-semibold text-text-faint">
            Recent sessions · {view.recent.length}
          </h2>
          <ul className="flex flex-col gap-2">
            {view.recent.map((entry) => {
              const code = entry.courseId ? codeOf.get(entry.courseId) : undefined;
              return (
                <li
                  key={`${entry.kind}-${entry.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-sm"
                >
                  <span className="w-full shrink-0 text-xs text-text-faint sm:w-36">
                    {WHEN.format(entry.at)}
                  </span>
                  <span className="w-12 shrink-0 text-xs text-text-muted">
                    {entry.kind === "writing" ? "Writing" : "Timer"}
                  </span>
                  <span className="tabular-nums text-text">
                    {Math.max(1, Math.round(entry.seconds / 60))}m
                  </span>
                  {code && <span className="font-mono text-[13px] text-accent-ink">{code}</span>}
                  {entry.kind === "writing" && (
                    <span className="ml-auto text-xs text-text-muted">
                      <span className="tabular-nums">{entry.wpm} wpm</span>
                      {" · "}
                      <span
                        className={
                          LOAD_STYLE[entry.load as CognitiveLoad] ?? "text-text-muted"
                        }
                      >
                        {entry.load}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {view.hasHistory && (
        <p className="mt-5 max-w-prose text-xs text-text-faint">
          The session label is a rough heuristic over two crude signals — how long you
          wrote and how fast you typed. It is an observation about the session, not a
          measure of you, and nothing in Anamnesis acts on it. A timer session is only how
          long the clock ran.
        </p>
      )}
    </div>
  );
}
