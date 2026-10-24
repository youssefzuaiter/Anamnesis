import Link from "next/link";
import { auth } from "@/auth";
import { requireUserId } from "@/lib/session";
import { getProfile } from "@/repositories/profile-repository";
import { ProfileForm } from "@/components/profile-form";
import { ReindexButton } from "@/components/reindex-button";

export const metadata = { title: "Settings · Anamnesis" };

export default async function SettingsPage() {
  const userId = await requireUserId();
  const [profile, session] = await Promise.all([getProfile(userId), auth()]);

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
        <a href="/api/export" className="text-accent hover:underline">
          Download everything as JSON
        </a>
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
