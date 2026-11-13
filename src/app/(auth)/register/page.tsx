import Link from "next/link";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { registerAction } from "@/actions/auth";
import { currentRegistrationMode } from "@/services/registration-service";
import { config } from "@/lib/config";

export const metadata = { title: "Create account · Anamnesis" };

export default async function RegisterPage() {
  // Who may register depends on the accounts that exist now, never on the build.
  await connection();
  const mode = await currentRegistrationMode(config.REGISTRATION_CODE);
  const signIn = (
    <p className="mt-5 text-center text-sm text-text-muted">
      Already have an account?{" "}
      <Link href="/login" className="font-semibold text-accent-ink hover:underline">
        Sign in
      </Link>
    </p>
  );

  if (mode === "closed") {
    return (
      <>
        <h1 className="text-[28px] font-bold leading-tight text-text">Registration is closed</h1>
        <p className="mt-2 text-sm text-text-muted">
          This workspace already has its account. New accounts need an invite code, and none is set on this server.
        </p>
        {signIn}
      </>
    );
  }

  return (
    <>
      <h1 className="text-[28px] font-bold leading-tight text-text">Create your account</h1>
      <p className="mb-7 mt-2 text-sm text-text-muted">
        {mode === "open"
          ? "This is the first account on this server. After it, new accounts need an invite code."
          : "Everything you add stays in your own database, on this machine."}
      </p>
      <AuthForm action={registerAction} mode="register" inviteCode={mode === "code"} />
      {signIn}
    </>
  );
}
