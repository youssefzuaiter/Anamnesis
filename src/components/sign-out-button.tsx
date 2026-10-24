"use client";

import { useFormStatus } from "react-dom";
import { signOutAction } from "@/actions/auth";
import { Icon } from "@/components/icons";

const SIDEBAR_CLASS =
  "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-60";

function Button({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      <Icon name="signOut" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function SignOutButton({ className = SIDEBAR_CLASS }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <Button className={className} />
    </form>
  );
}
