"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/lib/action-state";
import { createSessionValue, isOwnerPassword, SESSION_COOKIE } from "@/server/auth/session";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

/**
 * Sign-in for the single owner.
 *
 * A public deployment with one password needs brute-force protection, so
 * attempts are throttled per client address in memory. That is per instance,
 * which is enough given the password never leaves the environment.
 */
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;

function throttle(key: string, now: number): boolean {
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    if (attempts.size > 5_000) attempts.delete(attempts.keys().next().value!);
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const env = getEnv();
  const headerList = await headers();
  const client = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? "local";
  const now = Date.now();

  if (throttle(client, now)) {
    logger.warn("sign-in throttled", { client });
    return actionError("Too many attempts. Wait a few minutes and try again.");
  }

  const password = String(formData.get("password") ?? "");
  if (!password || !isOwnerPassword(password, env.OWNER_PASSWORD)) {
    return actionError("Incorrect password.");
  }

  const expiresAt = now + env.SESSION_MAX_AGE_DAYS * 86_400_000;
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionValue(expiresAt, env.AUTH_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
  attempts.delete(client);

  const next = String(formData.get("next") ?? "/dashboard");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function signOutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}
