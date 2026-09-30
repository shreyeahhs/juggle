import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getEnv } from "@/server/env";

/**
 * Single-owner dashboard session.
 *
 * There are no accounts: one password from the environment, one signed cookie.
 * The cookie carries only an expiry and a signature, so there is no session
 * table and nothing to invalidate beyond changing AUTH_SECRET or the password.
 */

export const SESSION_COOKIE = "juggle_session";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `<expiry ms>.<signature>` */
export function createSessionValue(expiresAt: number, secret: string): string {
  return `${expiresAt}.${sign(String(expiresAt), secret)}`;
}

export function verifySessionValue(value: string | undefined, secret: string, now = Date.now()): boolean {
  if (!value) return false;
  const separator = value.indexOf(".");
  if (separator <= 0) return false;
  const expiry = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!safeEqual(signature, sign(expiry, secret))) return false;
  const expiresAt = Number(expiry);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/** Constant-time password check against the configured owner password. */
export function isOwnerPassword(candidate: string, expected: string): boolean {
  return safeEqual(candidate, expected);
}

/**
 * True when the request carries a valid owner session.
 *
 * The cookie is read *before* the environment on purpose: touching a request
 * API first marks the route as request-time, so pages are never prerendered at
 * build time, where no configuration exists.
 */
export const isSignedIn = cache(async (): Promise<boolean> => {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionValue(value, getEnv().AUTH_SECRET);
});

/** For pages: sends signed-out visitors to the sign-in screen. */
export async function requireOwner(returnTo?: string): Promise<void> {
  if (!(await isSignedIn())) redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
}
