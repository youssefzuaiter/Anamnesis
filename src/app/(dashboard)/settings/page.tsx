import Link from "next/link";
import { auth } from "@/auth";
import { requireUserId } from "@/lib/session";
import { getProfile } from "@/repositories/profile-repository";
import { ProfileForm } from "@/components/profile-form";
import { CalendarFeedCard } from "@/components/calendar-feed-card";
import { ReindexButton } from "@/components/reindex-button";
import { getFeedLinkStatus } from "@/services/calendar-feed-service";

export const metadata = { title: "Settings · Anamnesis" };

export default async function SettingsPage() {
  const userId = await requireUserId();
  const [profile, session, feed] = await Promise.all([getProfile(userId), auth(), getFeedLinkStatus(userId)]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Settings
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Signed in as {session?.user?.email ?? "your account"}.
        </p>
      </header>

      <h2 className="mb-2 text-xs font-semibold text-text-faint">
        Profile
      </h2>
      <ProfileForm
        initial={{
          university: profile.university,
          program: profile.program,
          studentId: profile.studentId,
        }}
      />

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">
        Your data
      </h2>
      <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-4 text-sm">
        <div>
          <a href="/api/export" className="text-accent hover:underline">
            Download my data as JSON
          </a>
          <p className="mt-1 text-xs text-text-muted">
            Your notes and their versions, tasks, projects, goals, courses and grades, flashcards, events, links,
            assistant conversations and calendar feeds. Attachment files and calendar feed addresses are not in the
            file (the addresses are secrets, and the files are in the backup); deleted items and the search index are
            not either.
          </p>
        </div>
        <div>
          <a href="/api/export/vault" className="text-accent hover:underline">
            Download my notes as a Markdown vault (.zip)
          </a>
          <p className="mt-1 text-xs text-text-muted">
            One Markdown file for each note, with its attachments beside them and your{" "}
            <code className="font-mono">[[links]]</code> as they are, so Obsidian opens it as a vault. Restore from one
            under{" "}
            <Link href="/notes/import" className="text-accent hover:underline">
              Import notes
            </Link>
            . Only notes and their attachments are in it: tasks, events, flashcards, grades, earlier versions and deleted
            items are not, and the JSON file and the backup hold what a vault leaves out.
          </p>
        </div>
        <Link href="/trash" className="text-accent hover:underline">
          Restore deleted notes, tasks and projects
        </Link>
        <Link href="/focus" className="text-accent hover:underline">
          Focus tracking and its history
        </Link>
        <Link href="/audit" className="text-accent hover:underline">
          Review what the assistant proposed and what you approved
        </Link>
      </div>

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">
        Calendar feed
      </h2>
      <CalendarFeedCard active={feed.active} createdAt={feed.createdAt?.toISOString() ?? null} />

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">
        Search index
      </h2>
      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        <p className="mb-3 text-sm text-text-muted">
          Indexing happens as you write, but a save made while the local model
          was stopped leaves that item out of semantic search until it is saved
          again. Rebuilding re-embeds everything you own.
        </p>
        <ReindexButton />
      </div>
    </div>
  );
}
