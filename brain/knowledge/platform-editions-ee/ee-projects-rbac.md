---
icon: 👥
---

# EE Projects & RBAC

The EE Projects module adds team collaboration, git-based environment sync, and per-project piece filtering on top of the base project, behind the `projectRolesEnabled` and `environmentsEnabled` plan flags.

**RBAC itself is not edition-gated and never was.** `assertPrinicpalAccessToProject` reads no edition and no plan flag, and `authorizationMiddleware` is registered unconditionally in `app.ts`, so every edition — Community included — has enforced role permissions on every `securityAccess.project(...)` route since long before roles were exposed in the UI. Project Roles now ships on Community too: `src/app/project-roles/` and `src/app/project-members/` (MIT) serve `/v1/project-roles` and `/v1/project-members` there, while Cloud/EE keep their own `ee/projects/*` controllers.

### Members & roles
- **ProjectMember** entity: `(projectId, userId, projectRoleId, platformId)`, unique on (projectId, userId, platformId). Service: `upsert`, `list`, `getRole` (returns ADMIN if owner/platform admin), `update`, `delete`, `getIdsOfProjects`.
- **ProjectRole**: named permission set, platform-scoped, `type` DEFAULT/CUSTOM. Built-in: **ADMIN** (every permission), **EDITOR** (read + write flows/folders/tables, update flow status), **VIEWER** (read-only). Custom roles behind `customRolesEnabled`.
- **Permission**: one granular capability (`READ_FLOW`, `WRITE_CONNECTION`, etc.), almost all of them READ/WRITE pairs per feature area.

### RBAC enforcement
Yes, RBAC is a middleware layer. `rbacMiddleware` is registered once as a Fastify `preHandler` in `app.ts`, so every route passes through it. It resolves the route's project + permission and delegates to `rbacService`, which routes by principal type: **USER** goes to the member's role permission check; **ENGINE** checks `principal.projectId === requestedProjectId`; **SERVICE** checks `project.platformId === principal.platform.id`. UNKNOWN, WORKER and ONBOARDING are rejected outright.

The service method is spelled `assertPrinicpalAccessToProject()`, with the typo, in the code. Grep that spelling, not the corrected one, or you get zero hits. Flow-level checks use a separate `assertUserHasPermissionToFlow()`.

Note it lives under `ee/authentication/`, not `ee/projects/`, which is where most people look first.

### Releases & git sync
- **ProjectRelease**: snapshot of flow/table/connection state, applied atomically, `type` GIT_BRANCH/MANUAL/ROLLBACK. Workflow: `releasePlan()` computes a `ProjectSyncPlan` diff (including exact piece version changes), `create()` applies + serializes to a File. Memory lock prevents concurrent releases.
- **Git Sync**: SSH repo URL + branch + folder path; push exports published flows/tables, pull imports as a release source; individual-item push supported.

### Gotchas
- **RBAC has always been on for Community, so exposing roles there was additive, not restrictive.** Nobody could lose access, because `getRole` resolves the project owner and any same-platform `PlatformRole.ADMIN` to the seeded Admin role and an `OPERATOR` to Editor *before* it ever reads `project_member` — and on Community that table was provably empty, since the only write path (invitation accept) was gated on `projectRolesEnabled`. Those three implicit fallbacks are load-bearing; do not touch them.
- **`role-seed.ts` is CE code and seeds ADMIN/EDITOR/VIEWER on every edition**, with hardcoded ids that must never change. So `project_role` is populated even on a Community install that has never seen the feature.
- **Three separate things gate the feature, and missing any one leaves it half-working**: the plan flags on `OPEN_SOURCE_PLAN` (`projectRolesEnabled`, `customRolesEnabled`), the hardcoded `SHOW_PROJECT_MEMBERS` flag in `flags/flag.service.ts` (which the EE flag hook overrides but Community's does not), and the two `projectRolesEnabled` checks inside `user-invitations/` that gate sending and accepting a project invitation. The invitation checks are the ones that decide whether a role can ever be assigned to anybody.
- **`checkAccess` in the web used to return `true` unconditionally on Community** while the server enforced for real, so the UI showed actions that the API then refused. Fixed by letting the hook fetch the caller's actual role on every edition.
- **`GET /v1/project-roles/:id` is `publicPlatform`, so the service must filter by platform itself.** A lookup by bare id leaks another platform's custom role name and full permission array to any authenticated user. The CE service scopes every read to `platformId OR type = DEFAULT` (built-ins are shared and have a null `platformId`).
- **`CreateProjectRoleRequestBody.type` is client-supplied**, so a caller can ask for `DEFAULT`. The CE service forces `RoleType.CUSTOM` on create — otherwise the admin creates a role that its own built-in-role guard then makes permanently un-editable and un-deletable through the API.
- **`permissions` is `z.array(z.string())` in the shared schema**, so unknown strings persist happily and then silently match no route check. The CE service validates each entry against the `Permission` enum.
- **A new `Permission` needs a row in the role dialog, or custom roles can never grant it.** The toggle list is a hardcoded array, `initialPermissions` in `packages/web/src/app/routes/platform/security/project-role/project-role-dialog.tsx`, and the dialog is a plain `.map()` over it. Default-role grants are hardcoded separately in `access-control-list.ts`, so a permission added there but not here is invisible: ADMIN/EDITOR/VIEWER have it, custom roles cannot be given it, and the feature's tab just never appears for those members. This has already shipped twice — Variables + Knowledge Base (GIT-1751), then Agents. Nothing catches the drift: CI neither typechecks nor unit-tests `web`, so add the row in the same PR as the enum entry.
- **Piece filtering** now via **piece sets** — `project.pieceSetId` (nullable FK, SET NULL). When `managePiecesEnabled`, new EE projects get the Default set on create; unassigned resolves to Default at filter time. This supersedes the legacy project-plan allow/block list.
- **Worker routing**: `workerGroupId` (bare label, `^[a-z0-9_-]+$`) gated by `workerGroupsEnabled`. When set, the project's `EXECUTE_FLOW`/`EXECUTE_WEBHOOK` jobs route to `project-<label>-jobs`; other job types unaffected. Set via `POST /v1/projects/:id`; `GET /v1/projects/worker-groups` (platform-admin) lists online project-scope workers, 402 when flag off.
- `platformProjectService.getForPlatform()`: admins see all, operators see all except others' personal, users see own personal + team projects they're a member of.

### Key files
Entry point: `rbacMiddleware`, registered as a `preHandler` hook in `app.ts`.

- `packages/server/api/src/app/project-roles/` and `packages/server/api/src/app/project-members/` — the Community modules (entity, service, controller, module). The entities live here for **every** edition; the EE services import them, since EE→CE is the allowed direction
- `packages/server/api/src/app/ee/authentication/project-role/` — where RBAC actually lives: `rbac-middleware.ts` and `rbac-service.ts`
- `packages/server/api/src/app/ee/projects/` — the projects module; members, roles and releases all sit under it
- `packages/server/api/src/app/ee/projects/project-members/` — member CRUD, role lookup
- `packages/server/api/src/app/ee/projects/project-role/` — built-in and custom roles
- `packages/server/api/src/app/ee/projects/project-release/` — release create, diff, apply
- `packages/server/api/src/app/ee/projects/project-release/git-sync/` — SSH repo push/pull
- `packages/server/api/src/app/core/security/v2/authz/` — calls into `rbacService` from the authz layer
- `packages/core/shared/src/lib/ee/project-members/` — `ProjectMember` types
- `packages/core/shared/src/lib/automation/project-release/` — `ProjectRelease`, `ProjectSyncPlan`
- `packages/web/src/features/members/` — members UI
- `packages/web/src/app/routes/platform/security/project-role/` — platform-admin role list and the permission-toggle dialog
- `packages/web/src/features/project-releases/` — releases + git sync UI

Paths verified 2026-09-01. An earlier version of this list pointed at `ee/project-members/`, `ee/project-role/`, `ee/project-release/` and `ee/git-sync/`; all four moved under `ee/projects/`.
