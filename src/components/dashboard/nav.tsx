"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/keys", label: "Keys" },
  { href: "/dashboard/requests", label: "Requests" },
];

export function DashboardNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <ul className={cn("flex items-center gap-1", className)}>
      {LINKS.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            aria-current={isActive(link.href, link.exact) ? "page" : undefined}
            className={cn(
              "inline-block rounded-sharp px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              isActive(link.href, link.exact) ? "bg-surface-muted text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
            )}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
