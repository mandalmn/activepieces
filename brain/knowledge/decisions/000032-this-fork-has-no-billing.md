---
title: This fork has no billing
icon: 🏢
status: accepted
---

# This fork has no billing

## Decision

Billing, subscriptions, seat limits, credit metering and every upsell surface are deleted from this
fork. `platform.plan.*` survives, but only as a feature-flag store.

## Context

This fork runs as an internal system for one company. It sells nothing and bills nobody, so the
entire commerce half of the platform was dead weight — and not merely inert. On Community it still
capped the install at **one team project** (`billedTeamProjectsLimit: 1`, refused with a 402),
rendered "Upgrade plan" and "Contact sales" buttons that opened dialogs Community never mounts, and
issued a recurring 404 from the seat-limit query on every visit to the users page.

Three paths also sent data off the box, none of which an internal deployment wants: every new
signup's email was POSTed to a vendor cloud function ignoring `AP_TELEMETRY_ENABLED`, a `/ingest`
reverse proxy forwarded to PostHog gated only on `system.isApp()`, and the "Contact Sales" button
opened a URL carrying the logged-in user's name, email and a base64 dump of every server flag.

## Why

The plan object fuses two unrelated things: commerce (prices, seats, credits, quotas) and feature
flags (`projectRolesEnabled`, `secretManagersEnabled`, …). Only the commerce half went. The flag
half is load-bearing — it is how every `platformMustHaveFeatureEnabled` gate and every
`platform.plan.*` read in the web app resolves, and `platformService.getPlan` returning
`OPEN_SOURCE_PLAN` is the entire Community delivery mechanism for it.

The rejected alternative was to strip the plan model outright and hardcode every feature on. That is
incoherent here: most flags gate modules the COMMUNITY branch of `app.ts` never registers, so
flipping them would expose features with no backend — the "looks enabled but silently broken"
failure `.claude/rules/self-hosting.md` forbids.

## Consequences

Community gains unlimited team projects, users and runs. `LockedFeatureGuard` survives and still
hides the features that genuinely have no Community backend (SSO, embedding, environments/git sync),
but it no longer sells anything. The `platform_plan` table keeps its commerce columns; only the code
that read them is gone. **EE and Cloud editions of this fork no longer function as commercial
editions** — Autumn/Stripe, AppSumo and licence activation are gone, which is the point.
