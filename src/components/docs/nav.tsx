"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const DOCS_SECTIONS = [
  {
    title: "Start here",
    links: [
      { href: "/docs", label: "Getting started" },
      { href: "/docs/authentication", label: "Authentication" },
      { href: "/docs/provider-keys", label: "Configuring keys" },
    ],
  },
  {
    title: "API",
    links: [
      { href: "/docs/api", label: "Using the API" },
      { href: "/docs/models", label: "Models" },
      { href: "/docs/streaming", label: "Streaming" },
      { href: "/docs/errors", label: "Errors" },
      { href: "/docs/rate-limits", label: "Rate limits and failover" },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/security", label: "Security" },
      { href: "/privacy", label: "Privacy" },
      { href: "/docs/faq", label: "FAQ" },
    ],
  },
] as const;

export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-5">
      {DOCS_SECTIONS.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="px-2 pb-0.5 font-mono text-[11px] text-ink-subtle">{section.title}</p>
          <ul>
            {section.links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className={cn(
                    "block rounded-sharp px-2 py-1.5 text-[13px] transition-colors",
                    pathname === link.href ? "bg-surface-muted font-medium text-ink" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
