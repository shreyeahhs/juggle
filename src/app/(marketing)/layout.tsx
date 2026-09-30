import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";
import { isSignedIn } from "@/server/auth/session";

const NAV = [
  { href: "/docs", label: "Docs" },
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
];

export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  const signedIn = await isSignedIn();

  return (
    <div className="flex min-h-dvh flex-col">
      {/* One line at every width, 56px tall. A nav bar is not a section. */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-2 text-ink">
            <Logo className="size-5" />
            <span className="text-[14.5px] font-semibold tracking-tight">{siteConfig.name}</span>
          </Link>

          <nav className="ml-1 hidden items-center gap-0.5 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-sharp px-2 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <a
              href={siteConfig.github}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden rounded-sharp px-2 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink sm:block"
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

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface-muted/25">
        <div className="mx-auto max-w-6xl px-5 py-9 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-sm space-y-2">
              <Link href="/" className="inline-flex items-center gap-2 text-ink">
                <Logo className="size-4" />
                <span className="text-[13.5px] font-semibold tracking-tight">{siteConfig.name}</span>
              </Link>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                Open source under the MIT licence. You bring the provider keys and host it yourself. Nothing here resells AI inference.
              </p>
            </div>

            <nav className="flex gap-10 text-[12.5px]">
              <div className="space-y-1.5">
                {NAV.map((item) => (
                  <Link key={item.href} href={item.href} className="block text-ink-muted hover:text-ink">
                    {item.label}
                  </Link>
                ))}
              </div>
              <div className="space-y-1.5">
                <a href={siteConfig.github} target="_blank" rel="noopener noreferrer" className="block text-ink-muted hover:text-ink">
                  GitHub
                </a>
                <Link href="/docs/faq" className="block text-ink-muted hover:text-ink">
                  FAQ
                </Link>
                <Link href="/login" className="block text-ink-muted hover:text-ink">
                  Sign in
                </Link>
              </div>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
