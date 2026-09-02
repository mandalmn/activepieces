---
icon: ✨
title: AI Flow Builder
---

# AI Flow Builder

The prompt-first entry point to automations: the user describes what they want in plain
language, the **Workflow Planner** interprets it, and a preview is drafted onto the canvas.

Two backend stages, deliberately separate:

- **`POST /v1/ai-flow-builder/plan`** — the planner. Sends the prompt to a text model and
  gets back a **Workflow Plan**: a provider-independent description of *what* the automation
  does (name, trigger, schedule, ordered steps with `dependsOn`). It never names a piece,
  connector or vendor product; `service` is a category such as `email` or `chat`.
- **`POST /v1/ai-flow-builder/resolve`** — the **Tool / Piece Resolver**. Turns each abstract plan
  step into an exact piece + action/trigger. Returns a `ResolvedWorkflowPlan`; it builds no flow.
- **`POST /v1/ai-flow-builder/generate`** — turns a plan into a real flow: a schedule trigger
  plus one suggested piece action.

The resolver runs **retrieve → rank → adjudicate → fall back**. Retrieval finds candidate *pieces*
three ways (a lexical scan of the catalogue, `pieceMetadataService.list({ searchQuery })`, and
`toolSearchService`), then expands the shortlisted pieces' real actions from `pieceMetadataService.get`.
Ranking is a pure function over name-token coverage, semantic cosine, text overlap, connection
availability, `classification` vs step kind, and a penalty for generic pieces. The model is only asked
to break a tie, and only ever sees a shortlist of at most `MAX_TOOL_SHORTLIST` rows of metadata.

Every planner response passes three gates before the UI sees it: `JSON.parse`, the
`WorkflowPlan` Zod schema, and `workflowPlanValidator` (duplicate/unknown/self/cyclic step
ids, and schedule consistency — cron shape and IANA timezone).

## Gotchas

- **`/generate` used to re-parse the prompt with `promptScheduleParser`, an English-only
  regex.** A Mongolian prompt ("өдөр бүр 7 цагт …") matched nothing, so the endpoint returned
  `NEEDS_MORE_DETAIL` and "Open in builder" silently did nothing — even though the planner had
  already read the same sentence correctly. The client now sends the plan it is previewing and
  `/generate` uses `plan.trigger.schedule`; the regex parser is only the fallback when no plan
  is supplied. Any new prompt-reading logic must go through the model, not a regex.
- **The plan arrives from the browser**, so `/generate` re-runs `workflowPlanValidator` on it
  and falls back to the prompt parser when it fails. The cron lands straight in the schedule
  trigger's input, which is why the validator checks each cron field's shape and not just that
  there are five of them.
- **The schedule piece is not seeded in the API test database.** Without an explicit
  `piece_metadata` row for `@activepieces/piece-schedule`, `applyScheduleTrigger` logs a warning
  and leaves an empty trigger — a test asserting on `version.trigger.settings` reads `undefined`
  rather than failing loudly.
- **Prompt example strings are i18n keys**, so a new example needs an entry in both
  `en/translation.json` and `mn/translation.json` or the Mongolian UI shows English.

Once a piece is chosen, the **credential binder** picks the account: exactly one connection binds
automatically; a request naming "work" or "personal" binds by display name; otherwise the account the
project already uses for that piece in its other flows wins; anything still ambiguous comes back as
`NEEDS_SELECTION` with safe options. **No connection data reaches the model** — the whole ladder is
plain code in `resolver/credential-binder.ts`.

Finally the **flow assembler** turns the resolved plan into a real flow: `flowService.create`, one
`UPDATE_TRIGGER`, then one `ADD_ACTION` per step through Activepieces' own operations. It writes no
database rows of its own and never publishes.

A generated flow is then checked by the **flow validator** — deterministic code over the piece
schemas, no model involved — which returns a readiness verdict (`READY` / `MISSING_CONNECTION` /
`NEEDS_REPAIR`) and, per step, whether it is safe to test automatically.

When validation is `NEEDS_REPAIR`, the **repair loop** asks a model for narrowly scoped patches,
screens every one against real metadata, applies them through `UPDATE_ACTION`, and revalidates.

A flow that validates clean is then published through `LOCK_AND_PUBLISH` — the same operation the
builder's Publish button uses — and activated only when the **activation policy** allows it.

An existing automation can then be changed by talking to it: `POST /v1/ai-flow-builder/edit` turns
one instruction into the smallest set of changes, each mapped onto an existing flow operation.

### Conversational edit gotchas

- **The flow is the session.** There is no conversation table: every turn reloads the flow, so the
  current graph is the shared state and `flow_version` history is the audit trail. Multi-turn works
  because turn N+1 reads what turn N wrote.
- **The model may only choose from six operations**, each mapping onto an operation Activepieces
  already has: `CHANGE_SCHEDULE`→UPDATE_TRIGGER, `ADD_ACTION`/`ADD_CONDITION`→ADD_ACTION (+MOVE_ACTION),
  `REMOVE_ACTION`→DELETE_ACTION, `UPDATE_ACTION_INPUT`/`CHANGE_CONNECTION`→UPDATE_ACTION. It never
  emits flow JSON.
- **Guarding a step with a condition is two operations, not one**: ADD_ACTION a ROUTER after the
  source step, then MOVE_ACTION the guarded step to `INSIDE_BRANCH` at `branchIndex: 0`. Splicing a
  router with AFTER alone leaves the step *after* the router, not inside it.
- **`BranchCondition` is a strict discriminated union.** Mixing number and text operators in one
  value type will not compile — narrow the operator before building the object, and keep the editable
  operator set small.
- **`CHANGE_CONNECTION` matches on display name and must be unambiguous.** Two accounts matching the
  same words is `AMBIGUOUS_CONNECTION`, not a coin flip; `auth` itself is never directly writable.
- **Every turn revalidates, and republishes only if the flow was already published and is READY** —
  an edit can never silently activate something that was still a draft.

### Publish gotchas

- **The core publish path has no validity guard, so the guard lives in this service.** `flowService`
  checks `state === LOCKED`, never `flowVersion.valid`. Refusing to publish an invalid *generated*
  flow is enforced in `flowPublishService`; ordinary flows keep their existing behaviour, which is
  deliberate — adding a global guard would change publishing for every user.
- **A held activation still publishes.** `LOCK_AND_PUBLISH` runs with `status: DISABLED`, so the flow
  gets a locked published version and shows as `READY`; approving later only flips the status. That
  keeps one lifecycle rather than inventing a parallel "pending" state.
- **An undeclared `classification` is treated as unknown risk, not as safe.** Roughly half the
  catalogue declares one, so this holds a real share of flows for approval — the conservative default
  is the point, and it relaxes on its own as pieces add classifications.
- **Lifecycle is derived, never stored.** `ACTIVE`/`READY`/`NEEDS_SETUP` are computed from the flow's
  own `status` + `publishedVersionId` + validation, so nothing can drift out of sync with the flow.
- **A mutation callback cannot read a React state value its own caller just set.** This bit twice —
  once for `flowId` in repair, once again in publish. Take it from the mutation's `variables`.

### Repair gotchas

- **The model may only patch, never build.** Its whole vocabulary is `SET_PROPERTY`,
  `CLEAR_PROPERTY` and `REPLACE_ACTION` on a step that already exists. There is no operation that
  adds or removes a step, so no prompt can make repair grow the flow.
- **Every patch is screened before it is applied**: the step must exist, the property must be
  declared by the action, `auth` is never patchable, a value carrying `{{connections[...]}}` is
  rejected, and `REPLACE_ACTION` is limited to the same piece and may never introduce a DESTRUCTIVE
  action. A rejected patch is recorded, not silently dropped.
- **A repair is kept only if it strictly reduces the error count.** Anything that does not is
  reverted from a snapshot taken before it was applied — that is what stops a model making a flow
  worse while looking busy.
- **`CONNECTION_MISSING` is never sent to the model.** No patch can create a connection, so repair
  reports it as unrepairable instead of burning attempts on it. Same for a missing piece, an
  unconfigured trigger, an empty flow and duplicate step names.
- **The prompt gets redacted config, never credentials.** `auth` is dropped entirely and any
  `{{connections[...]}}` inside another value is replaced before the text is built.
- **A mutation callback must not read a React state value set in the same tick.** The validate
  callback originally read `flowId` from state that its own caller had just set, so repair never
  fired; take it from the mutation's `variables` argument instead.

### Validation and testing gotchas

- **`validateProps` silently DROPS unknown input keys rather than rejecting them.** It rebuilds
  `cleanInput` from the schema's own keys, so a misspelled property vanishes and `step.valid` stays
  true. Reporting unknown keys needs its own pass over `Object.keys(input)`.
- **`step.valid` is a single boolean and says nothing about WHY.** It is the right gate to reuse, but
  a per-property report has to re-walk `props` — that is a supplement, not a reimplementation.
- **An invalid flow can be published today.** The publish path checks `state === LOCKED`, never
  `flowVersion.valid`, so `publishable` from the validator is advisory. Do not assume the server
  blocks it.
- **Orphaned steps are impossible by construction.** A flow is one JSON tree rooted at the trigger, so
  `flowStructureUtil.getAllSteps` *is* the reachable set — a step not reachable does not exist. Don't
  write a reachability check; check duplicate step names instead, which references actually depend on.
- **Share `extractMustacheTokens` from `@activepieces/core-utils`.** It counts brace depth; a
  `/\{\{(.*?)\}\}/` regex truncates at the first `}}` and diverges from the runtime tokenizer.
- **`propertyPath.parse` returning null does NOT mean invalid.** `{{ step_1['output'].x + 2 }}`,
  `Math.min(...)` and ternaries all return null and all evaluate fine. Treat an unrecognised
  expression as opaque, never as a syntax error, or validation invents failures.
- **Testing a step really performs the external call.** `RunEnvironment.TESTING` is only a label;
  `useTestMethod` resolves true but `test` defaults to `run` for nearly every action. The only safety
  signal is `isReadOnlyClassification` (READ/SEARCH) — auto-test nothing else.

### Generation gotchas

- **A step's output is referenced as `{{stepName['output'].field}}`** — nested under `['output']`, and
  the trigger is `{{trigger['output'].field}}`, never `{{trigger.field}}`. A v20 migration
  (`expression-rewriter.ts`) rewrote the old bare form; emitting it is a silent runtime break.
- **Only write property names the piece declares.** The assembler filters every input key against the
  real `props` map, so a renamed or removed property is dropped rather than persisted as dead config.
- **Never guess a value into a field that addresses something.** An upstream reference is only ever
  written into a single required `LONG_TEXT` — a content field. Targeting "the one required text
  property" instead puts the previous step's whole output into the HTTP piece's `url`, and because the
  generic HTTP action is the resolver's own fallback, that is the common case, not a rare one.
- **A machine-written value must not clear its own requirement.** Report missing properties from what
  was filled *before* the reference merge, or a guessed value silently marks the field satisfied.
- **A skipped step must not break the chain.** A `TRANSFORM` with no service adds no flow step, so its
  plan id is mapped to its own upstream — otherwise every downstream reference is dropped.
- **The trigger belongs in the generated report.** It is built through the same input builder as the
  steps; discarding its requirements makes a trigger that still needs a connection read as configured.

### Credential gotchas

- **`appConnectionService.list()` decrypts every row it returns**, and it is the only piece-filtered
  query. Never use it to look up a connection for binding. `listSafeConnections` is the projection that
  selects `externalId`/`displayName`/`pieceName`/`scope` and never loads `value`.
- **`{{connections['<externalId>']}}` takes the externalId, never the row id.** Passing the id saves as
  `valid: true` and 404s on the first run.
- **`preSelectForNewProjects` is NOT a default-connection flag.** It has zero server-side readers — it
  is a project-membership pre-tick for global connections in the new-project dialog. It cannot express
  "which Gmail should this step use", which is why the established preference is derived from
  `flow_version.connectionIds` instead of a new column.
- **`flowService.list` migrates every version it returns**, persisting writes and paging on-call on
  failure. Never call it from a read-only path; query `flow_version` directly when you only need
  `connectionIds`.
- **displayName is untrusted, mutable and non-unique.** Match it in code against the candidate set and
  bind only on a single unambiguous match — never hand it to a model to pick from.

### Resolver gotchas

- **Search is used for piece discovery only, never for the action.** `toolSearchService`'s keyword
  floor builds its rows from `suggestedActions`, whose nested Fuse runs with Fuse's default
  `ignoreLocation: false, distance: 100` — a plan-shaped summary matches nothing, and a piece with no
  surviving suggestions contributes no row at all. Expanding actions from real metadata sidesteps both.
- **The planner's `service` is a retrieval key, not decoration.** Several real pieces declare no
  `description` at all (Microsoft Outlook, Microsoft Teams), so a description scan cannot see them.
  Searching the short `service` term ("email") matches their *action* text and is what surfaces them.
- **Name matching must score coverage, not a boolean.** `packages/pieces/community` holds 16
  `microsoft-*` pieces, most described "… by Microsoft". A boolean "the name matched" gives Outlook,
  Outlook Calendar and Planner the same score, and the piece shortlist then cuts the right one before
  ranking ever sees it. Score `matchedNameTokens / nameTokenCount`.
- **`audience: 'human'` must not be penalised here.** That flag hides an action from *agents calling
  tools*; the resolver is choosing steps for a flow a person will run, where a human-only action is
  perfectly valid.
- **The model may not veto a strong deterministic match.** If it abstains on a step whose top
  candidate is the app the plan named, the deterministic match stands — otherwise configuring an AI
  provider would make resolution worse than not having one.
- **Resolve the piece catalogue and the connected-piece set once per plan.** `toolSearchService`
  otherwise re-lists the whole catalogue and calls `appConnectionService.list` (which **decrypts every
  connection secret**) on every step. Use `appConnectionService.listConnectedPieces` — a projection
  that decrypts nothing — and pass both sets in via `enabledPieceNames` / `connectedPieceNames`.

## Key files

- `packages/server/api/src/app/ai-flow-builder` — planner, validator, model resolver, generation
- `packages/server/api/src/app/ai-flow-builder/resolver` — piece/action resolution (`workflowPlanResolverService`)
- `packages/core/shared/src/lib/automation/ai-flow-builder` — the `WorkflowPlan` contract
- `packages/web/src/features/ai-flow-builder` — prompt entry point and plan preview
