# Security policy

Juggle stores credentials that can spend real money, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability).

Please include:

- what an attacker can do, and what access they need to start
- steps to reproduce, ideally against a local instance
- affected version or commit
- any suggested fix

You can expect an acknowledgement within a few days and a status update as the fix progresses. Once a
fix is released we will credit you in the advisory unless you prefer otherwise.

**Never include real API keys, tokens or production data in a report.** Redact them, or describe the
shape of the value instead.

## Supported versions

This project is pre-1.0. Fixes land on the default branch, and self-hosters should track it.

## What is in scope

- Recovering provider key material from the database, an API response, a log line or an error message
- Forging a dashboard session, or bypassing the owner password
- Bypassing gateway-token authentication, rate limits or quotas
- Using the gateway to reach hosts it should not (SSRF), or as an unauthenticated proxy
- Injection of any kind, and CSRF against dashboard actions
- Secrets leaking into logs, analytics or error responses

## What is out of scope

- Anything requiring read access to the deployment's environment. Provider keys live there by design,
  as with any environment-configured service.
- A stolen gateway token being used until it is removed from the environment. Tokens are bearer
  credentials.
- Rate-limit strength on a deployment that has raised the shipped defaults.
- Findings in a provider's own API, or a provider's handling of a prompt.
- Missing hardening headers on a deployment that terminates TLS without them.
- Automated scanner output with no demonstrated impact.

## Deployment hardening

If you run Juggle for other people:

- Serve it over HTTPS only and set `TRUST_PROXY=true` behind your proxy, so client IPs and abuse
  throttling work.
- Generate `AUTH_SECRET` with `pnpm secrets:generate` and choose a strong `OWNER_PASSWORD`. Keep both
  out of version control and in your platform's secret manager.
- Database backups contain usage statistics and key fingerprints, never key material, so they are far
  less sensitive than your environment settings. Guard the environment accordingly.
- Rotate a provider key or gateway token by editing the environment variable and redeploying.
- Keep `REQUEST_LOG_RETENTION_DAYS` as low as your needs allow and run `pnpm db:prune` on a schedule.
