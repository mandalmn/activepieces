---
icon: 🔐
---

# Secret Managers

Lets platform admins connect Activepieces to an external secret store (HashiCorp Vault, AWS Secrets Manager, CyberArk Conjur, 1Password) so sensitive values in flow steps/connections resolve from the vault at runtime instead of the DB. Reference syntax: `{{<connectionId><separator><path>}}`.

Two server implementations serve the same `/v1/secret-managers` contract and the same table; the edition switch in `app.ts` picks one. Community registers `secretManagerModule` (`src/app/secret-managers/`, MIT, ungated). EE and Cloud register `secretManagersModule` (`src/app/ee/secret-managers/`, gated by `platform.plan.secretManagersEnabled`) and override the resolution seam with `secretResolver.set(secretManagersService)`.

### Entity
`secret_manager_connection`: id, platformId (FK, CASCADE), providerId, name, scope (`PLATFORM`/`PROJECT`, default PLATFORM), projectIds (jsonb, queried with PostgreSQL `@>` containment), auth (jsonb, encrypted provider config).

### Providers
- `hashicorp` (url, namespace?, roleId, secretId), `aws` (accessKeyId, secretAccessKey, region), `cyberark-conjur` (organizationAccountName, loginId, url, apiKey), `onepassword` (serviceAccountToken).

### How it works
- Endpoints under `/v1/secret-managers`: `GET` (list, `publicPlatform`), `POST` (create + test), `POST /:id` (update + re-test), `DELETE /:id`, `DELETE /cache` (invalidate).
- Resolution: `resolveString` resolves a `{{connectionId|path}}` key or returns it unchanged; `resolveObject` recurses; `resolveUnknownValue` dispatches; `containsSecretManagerReference` is an exported helper.
- Redis cache (`secret-manager-cache.ts`) caches secret values keyed `(platformId, connectionId, path)` and connection status keyed `(platformId, connectionId)`; invalidated on create/update/delete or the cache endpoint.

### Gotchas
- Separator is `SecretManagerFieldsSeparator` (a constant in `@activepieces/shared`, `|ap_sep_v1|` in the reference form).
- A value not starting with `{{` or lacking the separator is treated as a plain literal, not an error. This matters more than it looks: resolution runs over **every string field of every connection value** on upsert, on OAuth2 refresh and on the engine's connection fetch. A resolver that throws on ordinary strings breaks every connection; one that fails to pass them through hands the literal `{{...}}` to the third-party API, which surfaces as a confusing vendor 401 rather than a secret-manager error. `secret-manager-reference.test.ts` pins the pass-through cases.
- The `ee/` folder name does **not** mean enterprise-licensed. The root LICENSE carves out only `packages/ee/` and `packages/server/api/src/app/ee`, so `packages/core/shared/src/lib/ee/secret-managers/` and the whole web UI are MIT and shared by both implementations. Only the server directory needed a Community rewrite.
- `secret_manager_connection` is created by ungated migrations and exists on every edition, so Community needed no new table — but TypeORM allows only one EntitySchema per name, so the Community entity (`src/app/secret-managers/secret-manager.entity.ts`) is the single registered one and the EE service imports it. EE→CE imports are the allowed direction; the reverse is not.
- Four MIT call sites in `app-connection/` used to import the EE service directly. They now go through `secretResolver` (`hooksFactory`), which is what makes resolution work in Community at all.
- Community's list route cannot use `rbacService` (project roles are EE). It allows a platform admin to list platform-wide, and any other user only for a project belonging to their own platform. The response carries no credential material — only id, name, providerId, scope, projectIds and a configured/connected flag.
- create/update verify connectivity against the live vault before saving, so a wrong URL or role fails at connect time rather than at flow-run time.
- Redis is optional in Community, so every cache read/write is wrapped in `tryCatch`: without Redis, resolution still works and simply hits the vault each time.

### Key files
Entry points: `secretManagerModule` (Community) and `secretManagersModule` (EE/Cloud), registered from the edition switch in `packages/server/api/src/app/app.ts`.

- `packages/server/api/src/app/secret-managers/` — Community module, controller, service, TypeORM entity, cache, reference parser, and `secret-resolver.ts` (the `hooksFactory` seam)
- `packages/server/api/src/app/secret-managers/providers/` — Community providers, one file per vault plus the dispatcher
- `packages/server/api/src/app/ee/secret-managers/` — EE module, controller, service, Redis cache
- `packages/server/api/src/app/ee/secret-managers/secret-manager-providers/` — one file per provider (aws, hashicorp, cyberark-conjur, onepassword) plus the dispatcher
- `packages/core/shared/src/lib/ee/secret-managers/` — dto types, provider configs, request schemas
- `packages/web/src/features/secret-managers/` — frontend api + hooks
- `packages/web/src/app/routes/platform/security/secret-managers/` — platform admin UI page and connect dialog
- `packages/server/api/test/integration/ee/secret-managers/` — EE integration tests plus a hashicorp mock
- `packages/server/api/test/integration/ce/secret-managers/` and `packages/server/api/test/unit/app/secret-managers/` — Community route, resolution and provider tests
- `packages/server/api/src/app/app-connection/` — the main consumer, resolves references via `secretManagersService`

Paths verified 2026-09-01.
