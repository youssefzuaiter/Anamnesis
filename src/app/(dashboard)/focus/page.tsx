import { requireUserId } from "@/lib/session";
import { listSessions, isTrackingEnabled } from "@/repositories/focus-repository";
import { summarise, type CognitiveLoad } from "@/lib/focus";
import { FocusSettings } from "@/components/focus-settings";

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

export default async function FocusPage() {
  const userId = await requireUserId();
  const [sessions, enabled] = await Promise.all([
    listSessions(userId),
    isTrackingEnabled(userId),
  ]);

  const summary = summarise(sessions);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Focus</h1>
        <p className="mt-1 text-sm text-text-muted">
          How long your writing sessions run, and how quickly you write.
        </p>
      </header>

      <FocusSettings enabled={enabled} hasHistory={sessions.length > 0} />

      {sessions.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          {enabled
            ? "Nothing recorded yet. Write a note for a minute or so and it will appear here."
            : "Recording is off, so nothing has been collected."}
        </p>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Sessions" value={String(summary.sessions)} />
            <Stat label="Minutes written" value={String(summary.totalMinutes)} />
            <Stat label="Average WPM" value={String(summary.averageWpm)} />
            <Stat label="Longest session" value={`${summary.longestMinutes}m`} />
          </section>

          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold text-text-faint">
              Recent sessions · {sessions.length}
            </h2>
            <ul className="flex flex-col gap-2">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-sm"
                >
                  <span className="w-40 shrink-0 text-xs text-text-faint">
                    {WHEN.format(session.recordedAt)}
                  </span>
                  <span className="tabular-nums text-text">
                    {Math.max(1, Math.round(session.sessionDuration / 60))}m
                  </span>
                  <span className="tabular-nums text-text-muted">
                    {session.typingSpeedWpm} wpm
                  </span>
                  <span
                    className={`ml-auto text-xs ${
                      LOAD_STYLE[session.cognitiveLoad as CognitiveLoad] ??
                      "text-text-muted"
                    }`}
                  >
                    {session.cognitiveLoad}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <p className="mt-5 text-xs text-text-faint">
            The session label is a rough heuristic over two crude signals — how
            long you wrote and how fast you typed. It is an observation about the
            session, not a measure of you, and nothing in Anamnesis acts on it.
          </p>
        </>
      )}
    </div>
  );
}
