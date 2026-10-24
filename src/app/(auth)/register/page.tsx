import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { registerAction } from "@/actions/auth";

export const metadata = { title: "Create account · Anamnesis" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-[28px] font-bold leading-tight text-text">Create your account</h1>
      <p className="mb-7 mt-2 text-sm text-text-muted">
        Everything you add stays in your own database, on this machine.
      </p>
      <AuthForm action={registerAction} mode="register" />
      <p className="mt-5 text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-accent-ink hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
