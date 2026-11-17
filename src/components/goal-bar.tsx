import type { Progress } from "@/lib/weekly-goals";

/** One goal's progress this week: the numbers in words, and a bar that only repeats them (the bar never carries the meaning alone). */
export function GoalBar({ label, progress, compact = false }: { label: string; progress: Progress; compact?: boolean }) {
  const text = progress.reached ? `${progress.count} of ${progress.target}, reached` : `${progress.count} of ${progress.target}, ${progress.left} to go`;
  return (
    <div className="flex flex-col gap-1.5">
      <p className={`flex flex-wrap items-baseline justify-between gap-x-3 ${compact ? "text-sm" : "text-[15px]"}`}>
        <span className="font-semibold text-text">{label}</span>
        <span className="text-sm text-text">
          <b>{progress.count}</b> of {progress.target}
          {" · "}
          {progress.reached ? <b className="text-ok">Reached</b> : <span className="text-text-muted">{progress.left} to go</span>}
        </span>
      </p>
      <div role="img" aria-label={text} className={`overflow-hidden rounded-full bg-border-subtle ${compact ? "h-2" : "h-2.5"}`}>
        <div className={`h-full ${progress.reached ? "bg-ok" : "bg-accent"}`} style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
      </div>
    </div>
  );
}
