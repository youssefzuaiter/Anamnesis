import Link from "next/link";
import { CARD_LOG_BEGAN, counted, type WeekTotals } from "@/lib/study-stats";
import type { StatsOverview } from "@/services/stats-service";

const WEEK = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const BAR_AREA = 96;

type Chart = { title: string; unit: [string, string]; now: number; values: number[]; note: React.ReactNode };

function Bars({ chart, first }: { chart: Chart; first: string }) {
  const max = Math.max(...chart.values);
  const alt = `${chart.title} per week, oldest to newest: ${chart.values.join(", ")}`;
  return (
    <>
      <div role="img" aria-label={alt} className="flex h-24 items-end gap-1.5">
        {chart.values.map((value, index) => (
          <div key={index} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className={`rounded-t ${index === chart.values.length - 1 ? "bg-accent" : "bg-accent/45"}`}
              style={{ height: max === 0 ? 0 : Math.max(value > 0 ? 3 : 0, Math.round((value / max) * BAR_AREA)) }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-text-muted">
        <span>{first}</span>
        <span>This week</span>
      </div>
    </>
  );
}

const minutes = (seconds: number) => Math.round(seconds / 60);

/** The three weekly charts of the stats page (ROADMAP item 39): plain bars, no chart library, with their numbers in the label. */
export function StatsCharts({ stats }: { stats: StatsOverview }) {
  const weeks: WeekTotals[] = stats.weeks;
  const first = WEEK.format(weeks[0].start);
  const charts: Chart[] = [
    {
      title: "Tasks finished",
      unit: ["task", "tasks"],
      now: weeks[weeks.length - 1].tasks,
      values: weeks.map((week) => week.tasks),
      note: "Counted from when a task was marked done.",
    },
    {
      title: "Cards reviewed",
      unit: ["card", "cards"],
      now: weeks[weeks.length - 1].cards,
      values: weeks.map((week) => week.cards),
      note: `Counted from the review log, which began on ${CARD_LOG_BEGAN}. Before that, each card counts once, on its last review.`,
    },
    {
      title: "Study time",
      unit: ["min", "min"],
      now: minutes(weeks[weeks.length - 1].studySeconds),
      values: weeks.map((week) => minutes(week.studySeconds)),
      note: stats.recorderOn ? (
        "Recorded only while Remember timer sessions is on."
      ) : (
        <>
          Off. Turn on Remember timer sessions on the{" "}
          <Link href="/focus" className="text-accent-ink underline underline-offset-2">
            Focus page
          </Link>{" "}
          to chart it.
        </>
      ),
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {charts.map((chart) => (
        <section key={chart.title} aria-label={chart.title} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-bold text-text">{chart.title}</h2>
            <p className="text-[13px] text-text-muted">
              This week{" "}
              <strong className="text-text">
                {counted(chart.now, chart.unit[0], chart.unit[1])}
              </strong>
            </p>
          </div>
          <Bars chart={chart} first={first} />
          <p className="text-xs text-text-muted">{chart.note}</p>
        </section>
      ))}
    </div>
  );
}
