import { addonIframeManager } from "@/addons/iframe/addon-iframe-manager";

/**
 * Minimal lazy-activation coordinator (RFC Phase 3).
 *
 * Addons that contribute views boot their iframe runtime on first visit to a
 * contributed route rather than at startup. Addons WITHOUT contributed views
 * (and all dev-mode addons) are "pinned" and eager-booted at startup exactly as
 * before, so their runtime's `sidebar.addItem`/`router.add` calls still register
 * navigation.
 *
 * This module is deliberately framework-free (no React) so it can be unit
 * tested in isolation. Runtime existence is tracked by the iframe manager's
 * `runtimes` map — there is no separate state enum here (that is Phase 5
 * eviction machinery, added only when needed).
 */

type BootFn = () => Promise<boolean>;

// De-dupes concurrent activations of the same addon onto a single boot promise.
const inFlight = new Map<string, Promise<boolean>>();
// Addons that must eager-boot at startup.
const pinnedAddons = new Set<string>();
// The per-addon boot function registered by addons-core at (re)load time.
const bootFns = new Map<string, BootFn>();

/**
 * Registers an addon's boot function so it can be activated later (lazily or
 * eagerly). `pinned` addons are additionally tracked so the loader knows to
 * eager-boot them at startup.
 */
export function registerActivatable(
  addonId: string,
  bootFn: BootFn,
  { pinned }: { pinned: boolean },
): void {
  bootFns.set(addonId, bootFn);
  if (pinned) {
    pinnedAddons.add(addonId);
  } else {
    pinnedAddons.delete(addonId);
  }
}

/** Whether the addon must eager-boot at startup. */
export function isPinned(addonId: string): boolean {
  return pinnedAddons.has(addonId);
}

/**
 * Ensures the addon's iframe runtime is booted before its route is attached.
 *
 * - If the runtime already exists (pinned addons at nav time, or a previously
 *   activated lazy addon), resolves `true` immediately.
 * - Otherwise de-dupes on the in-flight map so N concurrent callers share one
 *   boot, cleaning up the map entry once the boot settles.
 * - Resolves `false` when no boot function is registered for the addon.
 */
export async function activateView(addonId: string): Promise<boolean> {
  if (addonIframeManager.hasRuntime(addonId)) {
    return true;
  }

  const existing = inFlight.get(addonId);
  if (existing) {
    return existing;
  }

  const bootFn = bootFns.get(addonId);
  if (!bootFn) {
    return false;
  }

  // No `await` before this assignment, so synchronously-concurrent callers all
  // observe the same in-flight promise and the boot function runs exactly once.
  const promise = bootFn().finally(() => {
    inFlight.delete(addonId);
  });
  inFlight.set(addonId, promise);
  return promise;
}

/** Forget a single addon's activation state (e.g. on unload). */
export function clearActivatable(addonId: string): void {
  bootFns.delete(addonId);
  pinnedAddons.delete(addonId);
  inFlight.delete(addonId);
}

/** Clear all activation state so a fresh `loadInstalledAddons` re-registers cleanly. */
export function resetActivations(): void {
  bootFns.clear();
  pinnedAddons.clear();
  inFlight.clear();
}

export const activationCoordinator = {
  registerActivatable,
  isPinned,
  activateView,
  clearActivatable,
  resetActivations,
};
