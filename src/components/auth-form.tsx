"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";

type AuthAction = (
  prevState: ApiResponse<null> | null,
  formData: FormData,
) => Promise<ApiResponse<null>>;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 min-h-11 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Please wait…" : label}
    </button>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  placeholder,
  minLength,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  placeholder?: string;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-text">{label}</span>
      <input
        name={name}
        type={type}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-[15px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
      />
    </label>
  );
}

export function AuthForm({
  action,
  mode,
}: {
  action: AuthAction;
  mode: "login" | "register";
}) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      // The session cookie is set by the action; refresh so server components
      // re-render with it before navigating into the protected shell.
      router.refresh();
      router.replace("/");
    }
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {mode === "register" && (
        <Field
          label="Name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
        />
      )}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === "register" ? "new-password" : "current-password"}
        minLength={mode === "register" ? 8 : undefined}
        placeholder={mode === "register" ? "At least 8 characters" : undefined}
      />

      {state && !state.success && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger"
        >
          {state.error.message}
        </p>
      )}

      <SubmitButton label={mode === "register" ? "Create account" : "Sign in"} />
    </form>
  );
}
