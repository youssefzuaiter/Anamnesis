import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { parseQuizScope } from "@/lib/quiz";
import { getScopeEntity } from "@/repositories/scope-repository";
import { QuizSession } from "@/components/quiz-session";

export const metadata = { title: "Quiz me · Anamnesis" };

export default async function QuizPage({ searchParams }: PageProps<"/quiz">) {
  const userId = await requireUserId();
  const params = await searchParams;
  // A scope in the address counts only if it is a note or a course and the caller's own. Anything
  // else, another account's id included, is the same "no longer exists": nothing is revealed.
  const scope = parseQuizScope(params.scope);
  const entity = scope ? await getScopeEntity(userId, scope) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Quiz me</h1>
        <p className="mt-1 text-sm text-text-muted">
          Questions come from your cards first, then from your notes. Type an answer and check it.
        </p>
      </header>

      {scope && entity ? (
        <QuizSession key={`${scope.kind}:${scope.id}`} scope={scope} label={entity.label} />
      ) : (
        <div className="rounded-xl border border-border-subtle bg-surface px-5 py-5 text-sm text-text">
          {scope && <p className="mb-2 font-medium">That {scope.kind} no longer exists.</p>}
          <p>
            Open a note or a course and choose Quiz me. Go to your{" "}
            <Link href="/notes" className="text-accent hover:underline">
              Notes
            </Link>{" "}
            or your{" "}
            <Link href="/courses" className="text-accent hover:underline">
              Courses
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
