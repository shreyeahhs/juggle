import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInForm } from "@/components/sign-in-form";
import { isSignedIn } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await isSignedIn()) redirect("/dashboard");

  return (
    <div className="space-y-6 rounded-sharp border border-line bg-surface p-6">
      <div className="space-y-1.5">
        <h1 className="display text-[1.5rem] font-semibold">Sign in</h1>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          This deployment has a single owner. Enter the password from its <code className="font-mono text-[12px]">OWNER_PASSWORD</code> setting.
        </p>
      </div>
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  );
}
