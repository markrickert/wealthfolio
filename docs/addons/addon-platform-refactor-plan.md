# Addon Platform Refactor — Implementation Plan

- **Status:** Draft for review — nothing below is implemented yet (except noted
  uncommitted prototypes)
- **Scope:** host app + addon-sdk + wealthfolio-addons repo
- **Related:** [rfc-addon-runtime-lifecycle.md](./rfc-addon-runtime-lifecycle.md)
  (adopted with amendments A1–A4 below),
  [addon-migration-guide-v3.5-to-v3.6.md](./addon-migration-guide-v3.5-to-v3.6.md)
- **Target line:** 3.6.x patch releases
- **Delivery:** two PRs — PR1 the whole refactor, PR2 the conformance harness

## 1. Context — why

The 3.6 sandbox migration (opaque-origin iframes, permission enforcement, server auth
gates) shipped hardening without its counterpart affordances. Confirmed fallout:

| Issue | Symptom |
| --- | --- |
| No durable addon storage (opaque origin blocks Web Storage; no replacement API) | Blank screens (`SecurityError` at load) or silently dead buttons (Swingfolio prefs) |
| Route/render contract trap (one shared container, per-route `createRoot` pattern) | Navigation buttons do nothing (Swingfolio "Save Selection" bug) |
| Server auth hard-gates (`ensure_addon_management_auth` + secrets + network broker) | "Addon management requires authentication" on auth-disabled self-hosted |
| `ui` permission category in consent | Technical noise on every install prompt; trains click-through |
| Eager lifecycle (every enabled addon boots an iframe realm at startup) | O(enabled) startup/memory cost — the RFC's subject |

## 2. Decisions (locked)

1. **Storage = SQLite** (`addon_storage` table), exposed as async `ctx.api.storage`
   (get/set/delete, string KV). Sanity caps only — key non-empty ≤128 chars, value
   ≤1 MiB — **no aggregate per-addon quota**: this is a single-user app where an
   installed addon is already trusted with the user's full data through the other
   APIs (which have no quotas either); the realistic risk is accidental runaway
   values, which the per-value cap covers with one length check.
   **Device-sync compatible by design, wired later:** the app's sync is
   outbox-event-based (`sync_outbox` + `SyncEntity` enum + LWW in
   `sync_entity_metadata` via event `client_timestamp` — no `updated_at` columns
   involved), so syncing addon storage is a contained follow-up: a
   `SyncEntity::AddonStorage` variant, outbox emission from the storage write path
   (`entity_id = addon_id:key`), and a remote applier. No v1 schema impact. See
   "Outlined only" for the open sync-all-vs-opt-in question.
   - NOT host `localStorage`: per-browser on web (divergent state across devices for
     self-hosted), outside `backupDatabase()`/restore on desktop (backup copies only
     the DB file — `crates/storage-sqlite/src/db/mod.rs:350`), browser-evictable.
   - NOT file-backed JSON: outside backups, second persistence mechanism.
   - SOTA precedent: VS Code `globalState` = SQLite; `chrome.storage` = LevelDB
     (docs warn against localStorage); Figma `clientStorage` = IndexedDB.
2. **No Web Storage shim** — `localStorage` stays permanently unsupported in the
   sandbox; addons must migrate to `ctx.api.storage`. Consequence: sandbox errors are
   classified and surfaced legibly (PR1-B) and docs/templates say this plainly.
3. **Baseline capabilities, code cleaned** — `ui`, `query`, `toast`, `logger`,
   `storage` are implicit capabilities, not permissions. The `ui` and `query`
   categories and their guard call sites are **removed from the code**; declarations
   that still appear in existing manifests are **silently ignored** (parse fine, never
   shown, never counted as escalation — no manifest rewriting). Real UI security
   controls (route-namespace validation, external-URL block in navigate) are
   untouched. Consented categories (all data categories, `files`, `network`,
   `secrets`, `events`, `snapshots`, `settings`) keep the guard exactly as today.
4. **Auth gates: full revert, nothing else** — delete the three `ensure_*_auth`
   server gates. Endpoints stay on the protected router, so middleware auth still
   applies whenever auth is configured.
5. **Adopt the lifecycle RFC** (Phases 0–3 implemented; 4–6 outlined, gated on
   telemetry) with amendments:
   - **A1** — durable storage is a prerequisite for lazy activation/eviction
     (re-booted realms lose in-memory state).
   - **A2** — view→renderer binding contract: a contributed view id MUST equal the
     route id the addon registers at runtime; runtime registrations duplicating a
     durable contribution are ignored.
   - **A3** — promote the `component` route API (single root owned by the platform).
   - **A4** — a conformance harness ships alongside (PR2), not just perf marks.
6. **Conformance harness lives in the host repo, fixture-only in CI** — existing
   Playwright e2e infra (`playwright.config.ts`, `e2e/`, `pnpm test:e2e` via
   `scripts/run-e2e.mjs`) + a fixture addon exercising the full contract. No
   cross-repo official-addons build in host CI (coupling/flake for a small team);
   officials are walked as a release-checklist step and later by the addons repo's
   own CI against a released host build.

## 3. Current working-tree state (relevant)

- **Uncommitted storage prototype (this effort, reshaped by PR1-A):** file-backed KV
  on `AddonService` (+trait +3 tests), Tauri commands, server endpoints
  `/addons/storage/{addon_id}/{key}`, web/tauri adapters + web command map. PR1 keeps
  the API surface, swaps internals to SQLite, deletes the file-backed path (never
  released → no data migration).
- **Unrelated user WIP (PRESERVE):** editable network-host approvals —
  `pages/settings/addons/{addon-settings.tsx, components/addon-permission-dialog.tsx,
  hooks/use-addon-actions.ts}`, `updateAddonNetworkApprovals` adapter index exports.
  PR1 touches these files; keep diffs surgical.
- **Addons repo:** Swingfolio bridge fixes (single root + storage fallback) shipped;
  `docs/sdk-3.6-sandbox-migration.md` drafted.

## 4. Key design resolutions

- **Repository placement (no new crate — the existing house pattern):** the workspace
  dependency arrow is `storage-sqlite → core`, so Diesel code cannot live in core
  (no schema/pool types there; the reverse dependency would be circular). Exactly like
  settings/limits/accounts/agent-PAT: `AddonStorageRepositoryTrait` (async CRUD:
  `get/set/delete/delete_all`, ~25 lines) in new
  `crates/core/src/addons/storage_repository.rs`. Diesel impl
  in new `crates/storage-sqlite/src/addons/` mirroring `agent/pat.rs` (pool +
  `WriteHandle`; reads via `get_connection`, writes via `writer.exec` +
  `replace_into` per `settings/repository.rs:203-223`). Local-only table → plain
  `exec`, not `exec_tx`. All validation is two length checks in the service (key
  ≤128 chars, value ≤1 MiB) — no quota queries anywhere. Uninstall cleanup stays
  owned by the service in one place instead of duplicated across the Tauri and
  server hosts.
- **Service shape:** async-ify the four `AddonServiceTrait` storage methods. The
  repository is a **required** third parameter —
  `AddonService::new(root, instance_id, storage_repo)` — no default, so a host that
  forgets it gets a compile error, not silent non-persistence.
  `InMemoryAddonStorageRepository` is **test-only** (plain `#[cfg(test)]` — no
  feature flag until a second crate actually needs it): the ~15 test constructor
  sites in `crates/core/src/addons/tests.rs` switch to a small
  `test_addon_service(&temp_dir)` helper that passes it explicitly, and core tests
  cover uninstall-clears-storage without a DB. Uninstall→clear stays inside the
  service; key/value length checks in the service; the repo is dumb CRUD.
- **Tauri wiring quirk:** `AddonService` is constructed per command
  (`apps/tauri/src/commands/addon.rs:12-22`, no DB). Build the repo once in
  `context/providers.rs` (pool/writer in scope), store on `ServiceContext`
  (`context/registry.rs`), pass state into the `addon_service()` helper to chain the
  builder. Server: build repo near `main_lib.rs:807`, chain before storing on
  `AppState`.
- **Baseline cleanup mechanics:** `BASELINE_PERMISSION_CATEGORIES =
  ['ui','query','toast','logger','storage']` + `isBaselineCategory()` in
  `packages/addon-sdk/src/permissions.ts`, used purely as an **ignore-filter** for
  legacy manifests. The `ui` (L218-224) and `query` (L204) entries are deleted from
  `PERMISSION_CATEGORIES`. `createPermissionGuard` (`type-bridge.ts:229-263`) returns
  allowed immediately for baseline categories and drops the `legacyUiNavigationAllowed`
  alias (L245-248). The `assertCanUse` call sites for baseline capabilities are
  **deleted**: `addon-iframe-manager.ts` L802 (`ui.sidebar.addItem`), L819
  (`ui.router.add`); `type-bridge.ts` L588 (`ui.navigation.navigate`), L598/L602
  (`query.*`); `addons-runtime-context.ts` L549/L559 (legacy path). Consent/display
  UI filters `isBaselineCategory` (which also hides legacy declarations) and the
  existing `ui` special-case in the warning count (`addon-permission-dialog.tsx`
  L99-105) is removed; `ui.*` entries leave `addon-function-names.ts`. Rust:
  `ensure_update_does_not_add_permissions` (`service.rs:2111`) skips baseline
  categories (mirrored const) so legacy `ui`/`query` declarations never count as
  escalation; the manifest parser keeps accepting them (round-trip untouched).
- **Registry/coordinator seams (RFC):** the registry absorbs the existing
  `dynamicNavItems`/`dynamicRoutes` maps (`addons-runtime-context.ts:105-106`) as its
  *transient* layer; `getDynamicNavItems`/`getDynamicRoutes`/
  `subscribeToNavigationUpdates` keep signatures and return merged durable+transient →
  **zero changes** in `app-navigation.tsx` and `routes.tsx`. Manifest
  `contributes.views` ingested at boot without executing addon code.
  `AddonIframeRoute` calls `activationCoordinator.activateView(addonId, viewId)`
  (in-flight promise dedupe) before `attachRoute`. Settings actions keep today's
  whole-world `reloadAllAddons()` (per-addon resync deferred — see §7). Pinned
  (eager, non-evictable): addons without `contributes.views` and all dev-mode addons.
- **Manifest round-trip gotcha:** `parse_manifest_json_metadata_with_options`
  (`service.rs:854`) hand-extracts fields — the new `contributes` field must be added
  to the `models.rs` struct AND the hand parser AND the struct literal (`:1019`),
  with install→update round-trip tests. (`activationEvents` is deferred to Phase 6 —
  Phases 0–3 only ever activate on view visit, the default, so the field would be
  dead schema.) `minWealthfolioVersion` becomes enforced (hard fail) at
  install/enable in Rust only — every install path goes through the backend, so a
  duplicate frontend check adds nothing; `validateAddonCompatibility` keeps its warn.

## 5. Delivery — two PRs

Ship as one refactor PR and one harness PR (user decision). Inside PR1, keep **one
commit (or commit series) per workstream below** so review and bisect stay tractable;
the PR is green as a whole (cargo + vitest), individual commits best-effort.

### PR1 — Addon platform refactor

**A. SQLite-backed addon storage**
- Migration `crates/storage-sqlite/migrations/<date>_addon_storage/{up,down}.sql`:
  `addon_storage(addon_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY(addon_id,key))`; hand-add to `schema.rs`. (No `updated_at` — nothing
  reads it, and device sync wouldn't either: the engine's LWW uses event
  `client_timestamp` in `sync_entity_metadata`, not domain-table columns.)
- `crates/storage-sqlite/src/addons/{mod.rs,storage.rs}` — `AddonStorageRepository`
  + diesel tests (tempdir + run_migrations + pool + writer, per
  `accounts/repository.rs` convention): upsert replaces without dup rows,
  `delete_all` scoped per addon, composite-PK isolation.
- `crates/core/src/addons/storage_repository.rs` — trait + test-only in-memory impl;
  `addon_traits.rs` — async-ify the 4 storage methods; `service.rs` — required repo
  param on `new`, validation in service, `.await` in uninstall, DELETE the
  file-backed `.storage` path/`ADDON_STORAGE_DIR_NAME`/`storage_lock`; `tests.rs` —
  `test_addon_service(&temp_dir)` helper + port prototype tests to async/in-memory.
- Tauri: `context/registry.rs`, `context/providers.rs`, `commands/addon.rs` (helper
  passes the repo from state; storage commands `.await`). Server: `main_lib.rs`
  builds repo, passes to `AddonService::new`; `api/addons.rs` handlers `.await`.
- Frontend: `addon-iframe-manager.ts` `ALLOWED_API_METHODS` += `storage.get/set/
  delete`; `addons-runtime-context.ts` attach `storage` in `createAddonHostAPI`
  alongside `secrets`.
- SDK: `StorageAPI` in `host-api.ts` + `storage` on `HostAPI`; export in `index.ts`.

**B. Sandbox error classification + surfacing**
- `addon-iframe-manager.ts` — classify `runtimeError`/`loadError`/`routeRenderError`
  messages (`SecurityError` + storage keywords → "this add-on uses browser storage,
  which is unavailable in the sandbox — update the add-on"; `AddonPermissionDenied`;
  `Unknown addon host API method`) into addon-attributed once-per-session toasts,
  following the `notifyPermissionDenialOnce` pattern (L172-187).
- `addon-iframe-route.tsx` — error state shows the classified message + addon id.

**C. Baseline permission cleanup** — exactly as §4 "Baseline cleanup mechanics":
SDK category deletions + ignore-filter, guard cleanup, call-site deletions, consent
UI filter, Rust escalation skip (+tests in `type-bridge.test.ts` and core tests).

**D. Server auth-gate removal**
- `apps/server/src/api/addons.rs` — delete `ensure_addon_management_auth` (:36) +
  12 call sites (:49,77,89,109,121,163,197,227,258,271,283,300); drop the stale
  "deliberately NOT behind the gate" comment on storage endpoints.
- `apps/server/src/api/secrets.rs` — delete `ensure_secret_api_auth` (:17) + 6 sites.
- `apps/server/src/api/addon_network.rs` — delete gate (:22) + 1 site.

**E. SDK `RouteConfig.component`**
- `packages/addon-sdk/src/types.ts` — `component?: ComponentType`; `render` optional;
  document one-of + the single-container contract. Sandbox dispatch already exists
  (`addon-sandbox-entry.tsx` L542-559); align error text. Update
  `addon-migration-guide-v3.5-to-v3.6.md`.

**F. Manifest schema + enforcement (RFC Phase 1, Rust/SDK half)**
- `models.rs` — `contributes: Option<AddonContributes>` (`views: Vec<{id, label,
  icon?, path, order?}>`). No `activationEvents` in v1 (deferred to Phase 6; the only
  v1 activation is on-view-visit, the default).
- `service.rs` — hand parser + struct literal + round-trip tests; enforce
  `minWealthfolioVersion` at install/enable (Rust only).
- SDK `manifest.ts` types.

**G. ContributionRegistry + nav/routes from registry (Phases 1–2)**
- `apps/frontend/src/addons/contribution-registry.ts` (+vitest) — durable layer:
  validation (route-namespace policy reuse, dup ids, external URLs), `getView`;
  absorbs the transient maps per §4. (No `getAddonForPath` — `AddonIframeRoute`
  already receives `addonId`/`routeId` as props from the route table.)
- `addons-core.ts` — ingest manifests into durable layer at boot (before iframes).
- Settings actions keep today's whole-world `reloadAllAddons()` (see §7 — per-addon
  `resyncAddon` deferred; with lazy activation a world reload is cheap because lazy
  addons don't re-boot until visited).
- Dev mode: unchanged — dev addons stay runtime-registered and pinned (no dev-scoped
  durable ingestion in v1).

**H. Lazy activation (Phase 3)**
- Coordinator kept minimal: an in-flight `Map<addonId, Promise>` for dedupe, a pinned
  set, and `activateView` — no formal state enum (runtime existence is already
  tracked by the iframe manager's `runtimes` map; a state machine is Phase 5
  eviction machinery, added when needed). Pinning: no-`contributes` + dev addons
  boot eagerly as today.
- `addons-core.ts` — startup boots only pinned; extract per-addon
  `loadAddonForRuntime` from the `Promise.all` loop (L185-196).
- `addon-iframe-route.tsx` — activate before attach; keep cold-skeleton UX.

### PR2 — Conformance harness + instrumentation
- `performance.mark/measure` per addon boot + route render
  (`addons-core.ts`, `addon-iframe-manager.ts`, `addon-iframe-route.tsx`) — resident
  count is derivable from the runtimes map/DOM, no separate gauge.
- `e2e/fixtures/addons/conformance-addon/` — source + prebuilt zip: one
  `contributes.views` entry, a `component` route, an enable-time
  `ctx.api.storage` write, one undeclared consented call (assert denial toast), one
  guarded `localStorage` touch (assert classified error, no crash).
- `e2e/11-addon-conformance.spec.ts` — asserts the **refactored** behavior: install
  fixture via UI; zero addon iframes at cold start, iframe appears on first route
  visit; storage roundtrip survives full reload (end-to-end SQLite proof); routes
  render with no `runtimeError`/`loadError`; permission denial → toast, no crash;
  localStorage use → classified error; consent dialog shows no baseline rows.
  (Official addons: release-checklist walk, not host CI — see §2.6.)

### Outlined only (gated on telemetry from PR2 instrumentation)
- **Phase 4 — dep slimming:** lazy-load `recharts`/`lucide-react` in
  `host-dependencies.ts` via top-level-await blob shims; shrinks every realm's
  baseline; zero addon migration.
- **Phase 5 — LRU eviction:** only if resident-set pressure shows in data; evict
  declarative addons only (legacy stay pinned, which also covers their lack of
  durable state); storage API is the state backend.
- **Phase 6 — activation events:** `onStartup` (official-only initially),
  `onCommand`, domain events.
- **Addon storage in device sync** — requirements verified against the engine
  (`crates/core/src/sync/app_sync_model.rs`, `crates/storage-sqlite/src/sync/`):
  1. `SyncEntity::AddonStorage` variant (`app_sync_model.rs:82`) + remote string
     mapping in `device-sync/src/types.rs::sync_entity_from_remote` (:568).
  2. Entity id is a single string; composite-PK convention is a deterministic
     `stable_id("addon_storage", &[addon_id, key])` (per
     `spending/deterministic_ids.rs:67`) with addon_id+key carried in the payload —
     confirms no schema/id column needed in v1.
  3. `SyncOutboxModel` impl on the row model (`sync/mod.rs:80`): `ENTITY`,
     `sync_entity_id_owned()` override, `delete_payload`, and
     `should_sync_outbox(op)` — the natural hook for opt-in key filtering.
  4. Outbox emission **in the same write transaction** via
     `outbox_request_for_model` + `insert_outbox_event` (atomicity is tested —
     `outbox_write_rollback_keeps_mutation_atomic`); payload encrypted at push
     (`payload_key_version`).
  5. `EntitySyncAdapter` impl + `EntityAdapterDescriptor` registration
     (`app_sync/adapters/mod.rs`): `serialize_*`, `apply_event_lww` (via
     `should_apply_lww`), **and `export_for_snapshot_import` /
     `import_from_snapshot_rowset`** — new-device bootstrap is a hard requirement,
     not optional.
  6. Add `"addon_storage"` to `APP_SYNC_TABLES` (base-table group, no FK deps);
     optional `SyncRowFilter` variant to scope synced rows — precedent:
     `SpendingSettings => "setting_key IN (...)"` filters the `app_settings` KV
     table by key.
  Policy decisions (locked): **sync-all** — no key filtering, `should_sync_outbox`
  always true, no `SyncRowFilter`, bootstrap exports the whole table; SDK docs must
  tell authors not to store per-device state in `ctx.api.storage`. **Ids:
  deterministic, not random UUIDs** — `stable_id("addon_storage", &[addon_id, key])`
  per the `deterministic_ids.rs` convention (random v4 ids would give the same
  logical key different identities per device → duplicates instead of LWW
  convergence); payload carries `addon_id` + `key`, applier upserts by them.
  **Uninstall `delete_all` stays local-only** (no delete events — the addon may
  still be installed on the other device); explicit `storage.delete(key)` propagates
  as a delete event. Desktop ↔ mobile pairing only; self-hosted web already shares
  the server DB across devices. v1 impact: none — single-write-closure repo writes
  are already the shape in-tx emission needs.

### wealthfolio-addons repo follow-ups (after host release)
- **PR-A:** Swingfolio → `ctx.api.storage` (drop localStorage fallback), `component`
  routes, `contributes.views`, drop `ui` permission block.
- **PR-B:** templates/scaffold — no `ui`/`query` declarations; `contributes.views` +
  `component` pattern; dev-tools detection stops emitting baseline categories.
- **PR-C:** `docs/sdk-3.6-sandbox-migration.md` + RFC — document storage API,
  baseline capabilities, `component`, `contributes.views`; state that Web Storage is
  permanently unsupported (no shim); amend RFC with A1–A4.

## 6. Verification

**PR1**
- `cargo test -p wealthfolio-core addons` (storage roundtrip/validation/lifecycle,
  manifest round-trip, escalation-skip), `cargo test -p wealthfolio-storage-sqlite`,
  `cargo test -p wealthfolio-server`, workspace `cargo check`.
- Frontend: `pnpm --filter frontend test` (type-bridge baseline tests, registry +
  coordinator units, adapter parity); SDK build + typecheck a `component`-only addon.
- Manual smoke: curl PUT/GET `/api/addons/storage/{id}/{key}` → row present, survives
  restart; uninstall works on an auth-disabled server (the reported bug); with auth
  configured, unauthenticated `/addons/*` still 401s via middleware; consent dialog
  for an addon declaring `ui` shows no baseline rows; cold start boots only pinned
  addons (inspect `#addon-sandbox-parking`).

**PR2**
- `pnpm test:e2e` — full conformance spec green (all assertions in §5 PR2);
  `performance.getEntriesByType('measure')` shows per-addon marks.

## 7. Open items for review

- Naming: `contributes.views` field names (`id/label/icon/path/order`) final?
- Quota numbers (128-char keys, 1 MiB/addon) — adjust?
- `events` kept consented (leaks data-activity timing) — confirm.
- Auth-gate removal ships with no replacement signal; a later "server runs
  unauthenticated" banner remains possible (explicitly out of scope now).
- Single-PR refactor: agreed; commits per workstream (A–H) keep it reviewable.

### Simplifications applied in the over-engineering pass
Dropped from v1 (each was speculative for Phases 0–3): `activationEvents` manifest
field (Phase 6), coordinator state enum (Phase 5), `getAddonForPath` +
`used_bytes` helpers, dev-scoped durable ingestion, frontend duplicate of
`minWealthfolioVersion` enforcement, `__wf_` key-prefix reservation, `test-utils`
feature flag, per-addon `resyncAddon` (whole-world reload stays; cheap once
activation is lazy — deviation from RFC §5.3 noted, revisit if world reloads ever
feel slow).

### Simplifications applied in the second pass (single-user lens)
The app is single-user by construction (local desktop/mobile, or self-hosted for one
person) — an installed addon is already trusted with the user's full data via the
other, quota-less APIs, and scale is a handful of addons. Accordingly:
- **Aggregate storage quota dropped** — per-value sanity cap only (value ≤1 MiB, key
  ≤128 chars): two length checks in the service, zero quota queries, no SUM, no
  race discussion. (This also resolves `used_bytes` for good.)
- **`updated_at` column dropped** — nothing reads it, including device sync
  (verified: the engine is outbox-event-based; LWW timestamps live in
  `sync_entity_metadata`, not on domain tables). Storage-in-sync is planned as a
  follow-up — see "Outlined only".
- **Official-addons walk moved out of host CI** — fixture-only conformance in CI;
  officials verified as a release-checklist step (resolves the previously pending
  item in the lean direction).
- **Resident-iframe gauge dropped** — perf marks suffice; count is derivable.

Deliberately NOT relaxed despite the single-user lens: sandbox isolation and consent
for data categories (the threat is the third-party addon author, not other users),
SQLite-backed storage (backup/restore + multi-device access to one self-hosted
instance), and lazy activation (mobile webviews make the memory work more relevant,
not less).
