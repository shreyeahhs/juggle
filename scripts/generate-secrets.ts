/**
 * Prints freshly generated secrets for .env:
 *   pnpm secrets:generate
 */
import { randomBytes } from "node:crypto";
import { generateGatewayKey } from "../src/server/crypto/tokens";

const password = randomBytes(15).toString("base64url");

console.log(`
Add these to your .env (never commit that file):

AUTH_SECRET="${randomBytes(32).toString("base64url")}"
OWNER_PASSWORD="${password}"
GATEWAY_API_KEYS="${generateGatewayKey().token}"

  AUTH_SECRET      signs your dashboard session. Changing it signs you out.
  OWNER_PASSWORD   the dashboard password. Replace it with one you'll remember.
  GATEWAY_API_KEYS the token your applications send. Add more, comma-separated,
                   and name them if you like:  prod=gw_live_...,dev=gw_live_...

Then set GEMINI_API_KEYS to your provider keys, comma-separated.
`);
