import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { loginAction } from "@/actions/auth";
import { safeNext } from "@/lib/share";

export const metadata = { title: "Sign in · Anamnesis" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // A share made while signed out comes back here; only a path on this site is followed.
  const next = safeNext((await searchParams).next) ?? "/";
  return (
    <>
      <h1 className="text-[28px] font-bold leading-tight text-text">Welcome back</h1>
      <p className="mb-7 mt-2 text-sm text-text-muted">
        Sign in to your workspace. Everything stays on this machine.
      </p>
      <AuthForm action={loginAction} mode="login" next={next} />
      <p className="mt-5 text-center text-sm text-text-muted">
        No account yet?{" "}
        <Link
          href="/register"
          className="font-semibold text-accent-ink hover:underline"
        >
          Create one
        </Link>
      </p>
    </>
  );
}
