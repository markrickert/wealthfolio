import type { AddonContext, Permission, SidebarItemConfig } from "@wealthfolio/addon-sdk";
import { toast } from "sonner";
import { createPermissionGuard, createSDKHostAPIBridge, type PermissionGuard } from "./type-bridge";

import {
  logger,
  checkActivitiesImport,
  getAccountImportMapping,
  importActivities,
  saveAccountImportMapping,
  createActivity,
  getActivities,
  saveActivities,
  searchActivities,
  updateActivity,
  createAccount,
  getAccounts,
  updateAccount,
  addonNetworkRequest,
} from "@/adapters";
import {
  addExchangeRate,
  getExchangeRates,
  updateExchangeRate,
  calculateDepositsForLimit,
  createContributionLimit,
  getContributionLimit,
  updateContributionLimit,
} from "@/adapters";
import { openCsvFileDialog, openFileSaveDialog } from "@/adapters";
import { createGoal, getGoals, getGoalFunding, saveGoalFunding, updateGoal } from "@/adapters";
import {
  listenFileDrop as listenImportFileDrop,
  listenFileDropCancelled as listenImportFileDropCancelled,
  listenFileDropHover as listenImportFileDropHover,
} from "@/adapters";
import {
  fetchDividends,
  getAssetProfile,
  getMarketDataProviders,
  getQuoteHistory,
  searchTicker,
  syncHistoryQuotes,
  syncMarketData,
  updateQuoteMode,
  updateAssetProfile,
  updateQuote,
} from "@/adapters";
import {
  calculateAccountsSimplePerformance,
  calculatePerformanceHistory,
  calculatePerformanceSummary,
  getHistoricalValuations,
  getHolding,
  getHoldings,
  getIncomeSummary,
  getLatestValuations,
  recalculatePortfolio,
  updatePortfolio,
  getSnapshots,
  getSnapshotByDate,
  saveManualHoldings,
  checkHoldingsImport,
  importHoldingsCsv,
  deleteSnapshot,
} from "@/adapters";
import {
  listenMarketSyncComplete,
  listenMarketSyncStart,
  listenPortfolioUpdateComplete,
  listenPortfolioUpdateError,
  listenPortfolioUpdateStart,
} from "@/adapters";
import {
  deleteAddonSecret,
  getAddonSecret,
  setAddonSecret,
  backupDatabase,
  getSettings,
  updateSettings,
} from "@/adapters";

export interface DynamicNavItem {
  icon?: string;
  title: string;
  href: string;
  order: number;
  id: string;
  addonId: string;
}

export interface DynamicRouteEntry {
  path: string;
  href: string;
  addonId: string;
  routeId: string;
  title?: string;
}

interface QueryClientLike {
  invalidateQueries: (opts: { queryKey: string[]; exact?: boolean }) => unknown;
  refetchQueries: (opts: { queryKey: string[]; exact?: boolean }) => unknown;
}

const dynamicNavItems = new Map<string, DynamicNavItem>();
const dynamicRoutes = new Map<string, DynamicRouteEntry>();
const disableCallbacks = new Map<string, Set<() => void>>();
const navigationUpdateListeners = new Set<() => void>();
const ADDON_ID_SUFFIX = "-addon";

let hostNavigate: ((route: string) => void) | undefined;
let hostQueryClient: QueryClientLike | undefined;

function navigateWithoutReload(route: string) {
  const targetUrl = new URL(route, window.location.href);
  if (targetUrl.origin !== window.location.origin) {
    console.warn(`Blocked addon navigation to external URL: ${route}`);
    return;
  }

  const normalizedRoute = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  window.history.pushState(null, "", normalizedRoute);
  const popStateEvent =
    typeof PopStateEvent === "function" ? new PopStateEvent("popstate") : new Event("popstate");
  window.dispatchEvent(popStateEvent);
}

export function setAddonNavigationHandler(navigate: (route: string) => void) {
  hostNavigate = navigate;
}

export function clearAddonNavigationHandler(navigate: (route: string) => void) {
  if (hostNavigate === navigate) {
    hostNavigate = undefined;
  }
}

export function setAddonQueryClient(queryClient: QueryClientLike) {
  hostQueryClient = queryClient;
}

function notifyNavigationUpdate() {
  navigationUpdateListeners.forEach((listener) => listener());
}

function scopedKey(addonId: string, id: string) {
  return `${addonId}:${id}`;
}

function cleanRoutePath(path: string) {
  const routeOnly = path.trim().split(/[?#]/, 1)[0] ?? "";
  const withSlash = routeOnly.startsWith("/") ? routeOnly : `/${routeOnly}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function toRouterPath(href: string) {
  return href.replace(/^\/+/, "");
}

function cleanRouteNamespace(namespace: string) {
  return namespace.trim().replace(/^\/+|\/+$/g, "");
}

function getOwnedAddonRouteNamespaces(addonId: string) {
  const cleanAddonId = cleanRouteNamespace(addonId);
  const addonSlug = cleanAddonId.endsWith(ADDON_ID_SUFFIX)
    ? cleanAddonId.slice(0, -ADDON_ID_SUFFIX.length)
    : cleanAddonId;
  return Array.from(new Set([cleanAddonId, addonSlug].filter(Boolean)));
}

function isPathWithinRoutePrefix(path: string, prefix: string) {
  const href = cleanRoutePath(path);
  const cleanPrefix = cleanRoutePath(prefix);
  return href === cleanPrefix || href.startsWith(`${cleanPrefix}/`);
}

function isAddonRouteNamespaceAllowed(addonId: string, path: string, aliases: string[] = []) {
  const href = cleanRoutePath(path);
  const namespaces = [...getOwnedAddonRouteNamespaces(addonId), ...aliases]
    .map(cleanRouteNamespace)
    .filter(Boolean);

  return namespaces.some(
    (namespace) =>
      href === `/addon/${namespace}` ||
      href.startsWith(`/addon/${namespace}/`) ||
      href === `/addons/${namespace}` ||
      href.startsWith(`/addons/${namespace}/`),
  );
}

function hasRegisteredAddonNavPrefix(addonId: string, path: string) {
  return Array.from(dynamicNavItems.values()).some(
    (item) => item.addonId === addonId && isPathWithinRoutePrefix(path, item.href),
  );
}

export function isAddonRoutePathAllowed(addonId: string, path: string) {
  return isAddonRouteNamespaceAllowed(addonId, path);
}

export function registerAddonNavItem(addonId: string, cfg: SidebarItemConfig) {
  const itemId = String(cfg.id || "").trim();
  const label = String(cfg.label || "").trim();
  if (!itemId || !label) {
    throw new Error("Addon sidebar items require a non-empty id and label");
  }

  const href = cleanRoutePath(cfg.route || `/addon/${addonId}`);
  if (!isAddonRoutePathAllowed(addonId, href)) {
    throw new Error(`Addon '${addonId}' cannot register sidebar route '${href}'`);
  }

  dynamicNavItems.set(scopedKey(addonId, itemId), {
    addonId,
    href,
    icon: typeof cfg.icon === "string" ? cfg.icon : undefined,
    id: scopedKey(addonId, itemId),
    order: typeof cfg.order === "number" ? cfg.order : 999,
    title: label,
  });
  notifyNavigationUpdate();
}

export function removeAddonNavItem(addonId: string, itemId: string) {
  dynamicNavItems.delete(scopedKey(addonId, itemId));
  notifyNavigationUpdate();
}

export function registerAddonRoute(
  addonId: string,
  route: { path: string; routeId: string; title?: string },
) {
  const routeId = String(route.routeId || "").trim();
  if (!routeId) {
    throw new Error("Addon routes require a non-empty routeId");
  }

  const href = cleanRoutePath(route.path);
  if (!isAddonRoutePathAllowed(addonId, href) && !hasRegisteredAddonNavPrefix(addonId, href)) {
    throw new Error(`Addon '${addonId}' cannot register route '${href}'`);
  }

  dynamicRoutes.set(scopedKey(addonId, routeId), {
    addonId,
    href,
    path: toRouterPath(href),
    routeId,
    title: route.title,
  });
  notifyNavigationUpdate();
}

export function removeAddonRoute(addonId: string, routeId: string) {
  dynamicRoutes.delete(scopedKey(addonId, routeId));
  notifyNavigationUpdate();
}

export function clearAddonRegistrations(addonId: string) {
  let changed = false;

  for (const [key, item] of dynamicNavItems) {
    if (item.addonId === addonId) {
      dynamicNavItems.delete(key);
      changed = true;
    }
  }

  for (const [key, route] of dynamicRoutes) {
    if (route.addonId === addonId) {
      dynamicRoutes.delete(key);
      changed = true;
    }
  }

  const callbacks = disableCallbacks.get(addonId);
  if (callbacks) {
    callbacks.forEach((cb) => {
      try {
        cb();
      } catch (error) {
        console.error("Error in addon disable callback:", error);
      }
    });
    disableCallbacks.delete(addonId);
  }

  if (changed) {
    notifyNavigationUpdate();
  }
}

export function getDynamicNavItems() {
  return Array.from(dynamicNavItems.values()).sort((a, b) => a.order - b.order);
}

export function getDynamicRoutes() {
  return Array.from(dynamicRoutes.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function subscribeToNavigationUpdates(callback: () => void) {
  navigationUpdateListeners.add(callback);
  return () => navigationUpdateListeners.delete(callback);
}

export function triggerNavigationUpdate() {
  notifyNavigationUpdate();
}

export function triggerAllDisableCallbacks() {
  Array.from(disableCallbacks.keys()).forEach(clearAddonRegistrations);
  dynamicNavItems.clear();
  dynamicRoutes.clear();
  notifyNavigationUpdate();
}

function createAddonScopedSecrets(addonId: string, guard: PermissionGuard) {
  return {
    set: async (key: string, value: string): Promise<void> => {
      guard.assertCanUse("secrets", "set");
      return setAddonSecret(addonId, key, value);
    },
    get: async (key: string): Promise<string | null> => {
      guard.assertCanUse("secrets", "get");
      return getAddonSecret(addonId, key);
    },
    delete: async (key: string): Promise<void> => {
      guard.assertCanUse("secrets", "delete");
      return deleteAddonSecret(addonId, key);
    },
  };
}

export function createAddonHostAPI(
  addonId: string,
  permissions?: Permission[],
): AddonContext["api"] {
  const permissionGuard = createPermissionGuard(addonId, permissions);
  const baseAPI = createSDKHostAPIBridge(
    {
      getHoldings: (accountId: string) => getHoldings({ type: "account", accountId }),
      getActivities,
      getAccounts,

      getExchangeRates,
      updateExchangeRate,
      addExchangeRate,

      getContributionLimit,
      createContributionLimit,
      updateContributionLimit,
      calculateDepositsForLimit,

      getGoals,
      createGoal,
      updateGoal,
      getGoalFunding,
      saveGoalFunding,

      searchTicker,
      fetchDividends,
      syncHistoryQuotes,
      getAssetProfile,
      updateAssetProfile,
      updateQuoteMode,
      updateQuote,
      syncMarketData,
      getQuoteHistory,
      getMarketDataProviders,

      updatePortfolio,
      recalculatePortfolio,
      getIncomeSummary: () => getIncomeSummary(undefined),
      getHistoricalValuations: (accountId?: string, startDate?: string, endDate?: string) =>
        getHistoricalValuations(
          accountId ? { type: "account", accountId } : { type: "all" },
          startDate,
          endDate,
        ),
      getLatestValuations,
      calculatePerformanceHistory,
      calculatePerformanceSummary,
      calculateAccountsSimplePerformance,
      getHolding,

      getSettings,
      updateSettings,
      backupDatabase,

      createAccount,
      updateAccount,

      searchActivities,
      createActivity,
      updateActivity,
      saveActivities,

      openCsvFileDialog,
      openFileSaveDialog,

      listenImportFileDropHover,
      listenImportFileDrop,
      listenImportFileDropCancelled,

      listenPortfolioUpdateStart,
      listenPortfolioUpdateComplete,
      listenPortfolioUpdateError,
      listenMarketSyncStart,
      listenMarketSyncComplete,

      importActivities,
      checkActivitiesImport,
      getAccountImportMapping,
      saveAccountImportMapping,

      getSnapshots,
      getSnapshotByDate,
      saveManualHoldings,
      checkHoldingsImport,
      importHoldingsCsv,
      deleteSnapshot,

      logError: logger.error,
      logInfo: logger.info,
      logWarn: logger.warn,
      logTrace: logger.trace,
      logDebug: logger.debug,

      navigateToRoute: async (route: string) => {
        if (hostNavigate) {
          hostNavigate(route);
        } else {
          navigateWithoutReload(route);
        }
      },

      getQueryClient: () => undefined,
      invalidateQueries: (queryKey: string | string[]) => {
        hostQueryClient?.invalidateQueries({
          queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
          exact: false,
        });
      },
      refetchQueries: (queryKey: string | string[]) => {
        hostQueryClient?.refetchQueries({
          queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
          exact: false,
        });
      },

      addonNetworkRequest: (request) => addonNetworkRequest(addonId, request),

      toastSuccess: (message: string) => toast.success(message),
      toastError: (message: string) => toast.error(message),
      toastWarning: (message: string) => toast.warning(message),
      toastInfo: (message: string) => toast.info(message),
    },
    addonId,
    permissionGuard,
  );

  return {
    ...baseAPI,
    secrets: createAddonScopedSecrets(addonId, permissionGuard),
  };
}

export function createAddonContext(addonId: string, permissions?: Permission[]): AddonContext {
  const permissionGuard = createPermissionGuard(addonId, permissions);

  return {
    ui: {
      root: document.createElement("div"),
    },
    sidebar: {
      addItem: (cfg) => {
        permissionGuard.assertCanUse("ui", "sidebar.addItem");
        registerAddonNavItem(addonId, cfg);

        return {
          remove: () => removeAddonNavItem(addonId, cfg.id),
        };
      },
    },
    router: {
      add: (route) => {
        permissionGuard.assertCanUse("ui", "router.add");
        registerAddonRoute(addonId, {
          path: route.path,
          routeId: route.id ?? route.path,
          title: route.title,
        });
      },
    },
    onDisable: (cb) => {
      const callbacks = disableCallbacks.get(addonId) ?? new Set<() => void>();
      callbacks.add(cb);
      disableCallbacks.set(addonId, callbacks);
    },
    api: createAddonHostAPI(addonId, permissions),
  };
}
