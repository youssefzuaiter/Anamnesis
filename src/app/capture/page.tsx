import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { captureTarget, captureText } from "@/lib/capture-link";
import { QuickCapture } from "@/components/quick-capture";

export const metadata = { title: "Quick capture · Anamnesis" };

/*
 * Quick capture (ROADMAP item 45): the capture box that is on Today, on a page of its own with nothing else on it, for a home-screen icon or an
 * iOS Shortcut to open. It sits outside the dashboard layout so a signed-out visit goes through sign-in and comes back here (the dashboard layout
 * cannot know which page was asked for). `?text=` only prefills the box; nothing is parsed or saved until the person presses Capture and confirms.
 */
export default async function CapturePage({ searchParams }: PageProps<"/capture">) {
  const text = captureText((await searchParams).text);
  if (!(await getSessionUserId())) redirect(`/login?next=${encodeURIComponent(captureTarget(text))}`);

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Quick capture</h1>
        <p className="mt-1 text-sm text-text-muted">
          Type or say it. You see what it would become, and nothing is saved until you confirm.
        </p>
      </header>

      <QuickCapture autoFocus initialText={text} />

      <p className="text-sm">
        <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-accent-ink hover:underline">
          Open Anamnesis
        </Link>
      </p>

      <details className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm text-text">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Put this on your home screen</summary>
        <div className="flex flex-col gap-2 pb-2 text-text-muted">
          <p>
            <b className="text-text">Android and desktop Chrome:</b> install Anamnesis, then long-press (or right-click) its icon and choose Quick capture.
          </p>
          <p>
            <b className="text-text">iPhone:</b> open this page in Safari, tap Share, then Add to Home Screen. Or make a Shortcut with the action Open URL set to
            this page&apos;s address and add it to your home screen. (Not tried on an iPhone yet.)
          </p>
          <p>
            A Shortcut can also ask for text first and open this address with <code className="font-mono text-xs text-text">?text=</code> and the text added, so
            the box arrives filled in.
          </p>
        </div>
      </details>
    </main>
  );
}
