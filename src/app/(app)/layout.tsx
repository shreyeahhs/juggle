import Link from "next/link";
import type { ReactNode } from "react";
import { DashboardNav } from "@/components/dashboard/nav";
import { SignOutButton } from "@/components/dashboard/sign-out";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireOwner } from "@/server/auth/session";

/** Shell for the owner's dashboard. Every page re-checks the session. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireOwner("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2">
            <Logo className="size-5" />
            <span className="text-[14.5px] font-semibold tracking-tight">Juggle</span>
          </Link>
          <nav className="ml-4 hidden md:block">
            <DashboardNav />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/docs" className="hidden text-[13px] text-ink-muted hover:text-ink sm:block">
              Docs
            </Link>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <div className="border-t border-line px-2 py-1.5 md:hidden">
          <DashboardNav className="overflow-x-auto" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
