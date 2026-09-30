import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { DocsNav } from "@/components/docs/nav";
import { siteConfig } from "@/lib/site";
import { isSignedIn } from "@/server/auth/session";

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const signedIn = await isSignedIn();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <Logo className="size-5" />
            <span className="text-[14.5px] font-semibold tracking-tight">{siteConfig.name}</span>
          </Link>
          <span className="text-[13px] text-ink-subtle">Docs</span>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={siteConfig.github}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden rounded-sharp px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink sm:block"
            >
              GitHub
            </a>
            <ThemeToggle />
            <Button as={Link} href={signedIn ? "/dashboard" : "/login"} size="sm">
              {signedIn ? "Dashboard" : "Sign in"}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-5 py-8 sm:px-8 lg:py-12">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-20">
            <DocsNav />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <details className="mb-6 rounded-sharp border border-line px-4 py-3 lg:hidden">
            <summary className="cursor-pointer text-[13px] font-medium text-ink">Documentation menu</summary>
            <div className="pt-3">
              <DocsNav />
            </div>
          </details>
          {children}
        </div>
      </div>
    </div>
  );
}
