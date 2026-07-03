import type { AddonManifest, Permission, SidebarItemConfig } from "@wealthfolio/addon-sdk";
import type { AddonFile } from "@/adapters/types";
import {
  clearAddonRegistrations,
  createAddonHostAPI,
  registerAddonNavItem,
  registerAddonRoute,
  removeAddonNavItem,
  removeAddonRoute,
} from "@/addons/addons-runtime-context";
import { logger } from "@/adapters";
import { createPermissionGuard, type PermissionGuard } from "../type-bridge";

const CHANNEL = "wealthfolio:addon-sandbox:v1";
const LOAD_TIMEOUT_MS = 10_000;

interface StartAddonInput {
  addonId: string;
  manifest: AddonManifest;
  code: string;
  files?: AddonFile[];
  permissions?: Permission[];
}

export interface AddonRouteLocation {
  pathname: string;
  search: string;
  hash: string;
  params: Record<string, string | undefined>;
}

export interface AddonRuntimeHandle {
  disable(): Promise<void>;
}

interface Runtime {
  addonId: string;
  nonce: string;
  iframe: HTMLIFrameElement;
  code: string;
  files: AddonFile[];
  api: unknown;
  activeContainer?: HTMLElement;
  activeRoute?: {
    location: AddonRouteLocation;
    routeId: string;
  };
  isLoaded: boolean;
  permissionGuard: PermissionGuard;
  routeRenderTimer?: number;
  subscriptions: Map<string, () => Promise<void> | void>;
  resolveLoad: (handle: AddonRuntimeHandle) => void;
  rejectLoad: (error: Error) => void;
  loadTimer: number;
}

interface SandboxMessage {
  channel?: string;
  addonId?: string;
  nonce?: string;
  type?: string;
  requestId?: string;
  method?: string;
  args?: unknown[];
  item?: SidebarItemConfig;
  itemId?: string;
  route?: {
    path?: string;
    routeId?: string;
    title?: string;
  };
  routeId?: string;
  subscriptionId?: string;
  error?: string;
}

function createNonce() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36)}`;
}

function createSandboxUrl(addonId: string, nonce: string) {
  const basePath = import.meta.env.BASE_URL || "/";
  const sandboxUrl = new URL(
    `${basePath.replace(/\/?$/, "/")}addon-sandbox.html`,
    window.location.href,
  );
  sandboxUrl.hash = new URLSearchParams({ addonId, nonce }).toString();
  return sandboxUrl.toString();
}

function makeRequestId() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (typeof error === "symbol") {
    return error.description ?? "Symbol";
  }
  if (typeof error === "function") {
    return error.name || "Function";
  }
  if (error === null || error === undefined) {
    return undefined;
  }
  return JSON.stringify(error) ?? "Unknown error";
}

function getParkingRoot() {
  let root = document.getElementById("addon-sandbox-parking");
  if (!root) {
    root = document.createElement("div");
    root.id = "addon-sandbox-parking";
    root.setAttribute("aria-hidden", "true");
    Object.assign(root.style, {
      height: "0",
      overflow: "hidden",
      position: "absolute",
      width: "0",
    });
    document.body.appendChild(root);
  }
  return root;
}

const ALLOWED_API_METHODS = new Set([
  "accounts.getAll",
  "accounts.create",
  "portfolio.getHoldings",
  "portfolio.getHolding",
  "portfolio.update",
  "portfolio.recalculate",
  "portfolio.getIncomeSummary",
  "portfolio.getHistoricalValuations",
  "portfolio.getLatestValuations",
  "activities.getAll",
  "activities.search",
  "activities.create",
  "activities.update",
  "activities.saveMany",
  "activities.import",
  "activities.checkImport",
  "activities.getImportMapping",
  "activities.saveImportMapping",
  "market.searchTicker",
  "market.syncHistory",
  "market.sync",
  "market.getProviders",
  "market.fetchDividends",
  "assets.getProfile",
  "assets.updateProfile",
  "assets.updateQuoteMode",
  "quotes.update",
  "quotes.getHistory",
  "performance.calculateHistory",
  "performance.calculateSummary",
  "performance.calculateAccountsSimple",
  "exchangeRates.getAll",
  "exchangeRates.update",
  "exchangeRates.add",
  "contributionLimits.getAll",
  "contributionLimits.create",
  "contributionLimits.update",
  "contributionLimits.calculateDeposits",
  "goals.getAll",
  "goals.create",
  "goals.update",
  "goals.getFunding",
  "goals.saveFunding",
  "goals.getAllocations",
  "goals.updateAllocations",
  "settings.get",
  "settings.update",
  "settings.backupDatabase",
  "files.openCsvDialog",
  "files.openSaveDialog",
  "snapshots.getAll",
  "snapshots.getByDate",
  "snapshots.save",
  "snapshots.checkImport",
  "snapshots.importSnapshots",
  "snapshots.delete",
  "navigation.navigate",
  "query.invalidateQueries",
  "query.refetchQueries",
  "network.request",
  "secrets.set",
  "secrets.get",
  "secrets.delete",
  "toast.success",
  "toast.error",
  "toast.warning",
  "toast.info",
  "logger.error",
  "logger.info",
  "logger.warn",
  "logger.trace",
  "logger.debug",
]);

const ALLOWED_EVENT_METHODS = new Set([
  "events.import.onDropHover",
  "events.import.onDrop",
  "events.import.onDropCancelled",
  "events.portfolio.onUpdateStart",
  "events.portfolio.onUpdateComplete",
  "events.portfolio.onUpdateError",
  "events.market.onSyncStart",
  "events.market.onSyncComplete",
]);

const FORBIDDEN_METHOD_PARTS = new Set(["__proto__", "constructor", "prototype"]);

function getProperty(target: unknown, key: string): unknown {
  if (typeof target !== "object" || target === null) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    return undefined;
  }
  return (target as Record<string, unknown>)[key];
}

function getMethod(target: unknown, methodPath: string, allowedMethods: Set<string>) {
  if (!allowedMethods.has(methodPath)) {
    throw new Error(`Unknown addon host API method '${methodPath}'`);
  }

  const parts = methodPath.split(".").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => FORBIDDEN_METHOD_PARTS.has(part))) {
    throw new Error(`Unknown addon host API method '${methodPath}'`);
  }

  let current = target;

  for (const part of parts) {
    current = getProperty(current, part);
  }

  if (typeof current !== "function") {
    throw new Error(`Unknown addon host API method '${methodPath}'`);
  }

  return current as (...args: unknown[]) => unknown;
}

export class AddonIframeManager {
  private runtimes = new Map<string, Runtime>();
  private listening = false;

  async startAddon(input: StartAddonInput): Promise<AddonRuntimeHandle> {
    await this.stopAddon(input.addonId);
    this.ensureListener();

    const nonce = createNonce();
    const sandboxUrl = createSandboxUrl(input.addonId, nonce);

    const iframe = document.createElement("iframe");
    iframe.title = `${input.manifest.name || input.addonId} add-on sandbox`;
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.referrerPolicy = "no-referrer";
    Object.assign(iframe.style, {
      border: "0",
      display: "block",
      height: "100%",
      width: "100%",
    });

    const credentiallessFrame = iframe as HTMLIFrameElement & { credentialless?: boolean };
    if ("credentialless" in credentiallessFrame) {
      credentiallessFrame.credentialless = true;
    }

    const loadPromise = new Promise<AddonRuntimeHandle>((resolve, reject) => {
      const runtime: Runtime = {
        addonId: input.addonId,
        api: createAddonHostAPI(input.addonId, input.permissions),
        code: input.code,
        files: input.files ?? [],
        iframe,
        isLoaded: false,
        loadTimer: window.setTimeout(() => {
          reject(new Error(`Timed out loading addon '${input.addonId}'`));
          void this.stopAddon(input.addonId);
        }, LOAD_TIMEOUT_MS),
        nonce,
        permissionGuard: createPermissionGuard(input.addonId, input.permissions),
        rejectLoad: reject,
        resolveLoad: resolve,
        subscriptions: new Map(),
      };
      this.runtimes.set(input.addonId, runtime);
    });

    getParkingRoot().appendChild(iframe);
    iframe.src = sandboxUrl;

    return loadPromise.finally(() => {
      const runtime = this.runtimes.get(input.addonId);
      if (runtime) {
        clearTimeout(runtime.loadTimer);
      }
    });
  }

  attachRoute(addonId: string, container: HTMLElement) {
    const runtime = this.runtimes.get(addonId);
    if (!runtime) {
      throw new Error(`Addon '${addonId}' is not loaded`);
    }

    runtime.activeContainer = container;
    if (runtime.iframe.parentElement !== container) {
      container.appendChild(runtime.iframe);
    }
    runtime.iframe.style.height = "100%";
    runtime.iframe.style.minHeight = "calc(100vh - 96px)";
    runtime.iframe.style.width = "100%";
    this.renderActiveRoute(runtime);
  }

  updateRoute(addonId: string, routeId: string, location: AddonRouteLocation) {
    const runtime = this.runtimes.get(addonId);
    if (!runtime) {
      throw new Error(`Addon '${addonId}' is not loaded`);
    }

    runtime.activeRoute = { routeId, location };
    this.renderActiveRoute(runtime);
  }

  detachRoute(addonId: string, container?: HTMLElement) {
    const runtime = this.runtimes.get(addonId);
    if (!runtime) {
      return;
    }
    if (container && runtime.activeContainer !== container) {
      return;
    }

    runtime.activeContainer = undefined;
    runtime.activeRoute = undefined;
    getParkingRoot().appendChild(runtime.iframe);
  }

  async stopAddon(addonId: string) {
    const runtime = this.runtimes.get(addonId);
    if (!runtime) {
      clearAddonRegistrations(addonId);
      return;
    }

    this.post(runtime, "disable");
    clearTimeout(runtime.loadTimer);
    if (runtime.routeRenderTimer) {
      clearTimeout(runtime.routeRenderTimer);
    }
    runtime.rejectLoad(new Error(`Addon '${addonId}' was unloaded before it finished loading`));
    for (const unsubscribe of runtime.subscriptions.values()) {
      try {
        await unsubscribe();
      } catch (error) {
        logger.warn(`Failed to remove addon event subscription: ${String(error)}`);
      }
    }
    runtime.subscriptions.clear();
    runtime.iframe.remove();
    this.runtimes.delete(addonId);
    clearAddonRegistrations(addonId);
  }

  private ensureListener() {
    if (this.listening) {
      return;
    }
    window.addEventListener("message", this.handleMessage);
    this.listening = true;
  }

  private handleMessage = (event: MessageEvent) => {
    const message = event.data as SandboxMessage;
    if (message?.channel !== CHANNEL || !message.addonId || !message.nonce) {
      return;
    }

    const runtime = this.runtimes.get(message.addonId);
    if (runtime?.nonce !== message.nonce) {
      return;
    }
    if (event.source !== runtime.iframe.contentWindow) {
      return;
    }

    void this.dispatchMessage(runtime, message);
  };

  private async dispatchMessage(runtime: Runtime, message: SandboxMessage) {
    try {
      switch (message.type) {
        case "ready":
          runtime.isLoaded = false;
          this.post(runtime, "loadAddon", {
            code: runtime.code,
            files: runtime.files,
          });
          break;
        case "loaded":
          runtime.isLoaded = true;
          runtime.resolveLoad({
            disable: () => this.stopAddon(runtime.addonId),
          });
          this.renderActiveRoute(runtime);
          break;
        case "loadError": {
          const error = new Error(message.error || `Failed to load addon '${runtime.addonId}'`);
          runtime.rejectLoad(error);
          await this.stopAddon(runtime.addonId);
          break;
        }
        case "runtimeError":
          logger.error(`Addon '${runtime.addonId}' runtime error: ${message.error || "unknown"}`);
          break;
        case "api":
          await this.handleApiCall(runtime, message);
          break;
        case "eventSubscribe":
          await this.handleEventSubscribe(runtime, message);
          break;
        case "eventUnsubscribe":
          await this.handleEventUnsubscribe(runtime, message);
          break;
        case "sidebar.addItem":
          this.handleSidebarAdd(runtime, message);
          break;
        case "sidebar.removeItem":
          this.handleSidebarRemove(runtime, message);
          break;
        case "router.add":
          this.handleRouterAdd(runtime, message);
          break;
        case "router.remove":
          this.handleRouterRemove(runtime, message);
          break;
        default:
          break;
      }
    } catch (error) {
      if (message.requestId) {
        this.respond(runtime, message.requestId, false, undefined, error);
      } else {
        logger.error(`Addon '${runtime.addonId}' message failed: ${String(error)}`);
      }
    }
  }

  private async handleApiCall(runtime: Runtime, message: SandboxMessage) {
    if (!message.requestId || !message.method) {
      return;
    }
    const method = getMethod(runtime.api, message.method, ALLOWED_API_METHODS);
    const result = await method(...(message.args ?? []));
    this.respond(runtime, message.requestId, true, result);
  }

  private async handleEventSubscribe(runtime: Runtime, message: SandboxMessage) {
    if (!message.requestId || !message.method) {
      return;
    }

    const method = getMethod(runtime.api, message.method, ALLOWED_EVENT_METHODS);
    const subscriptionId = makeRequestId();
    const unlisten = (await method((event: unknown) => {
      this.post(runtime, "event", { subscriptionId, payload: event });
    })) as () => Promise<void> | void;
    runtime.subscriptions.set(subscriptionId, unlisten);
    this.respond(runtime, message.requestId, true, { subscriptionId });
  }

  private async handleEventUnsubscribe(runtime: Runtime, message: SandboxMessage) {
    if (!message.requestId || !message.subscriptionId) {
      return;
    }
    const unlisten = runtime.subscriptions.get(message.subscriptionId);
    if (unlisten) {
      await unlisten();
      runtime.subscriptions.delete(message.subscriptionId);
    }
    this.respond(runtime, message.requestId, true, undefined);
  }

  private handleSidebarAdd(runtime: Runtime, message: SandboxMessage) {
    if (!message.requestId || !message.item) {
      return;
    }
    runtime.permissionGuard.assertCanUse("ui", "sidebar.addItem");
    registerAddonNavItem(runtime.addonId, message.item);
    this.respond(runtime, message.requestId, true, undefined);
  }

  private handleSidebarRemove(runtime: Runtime, message: SandboxMessage) {
    if (!message.requestId || !message.itemId) {
      return;
    }
    removeAddonNavItem(runtime.addonId, message.itemId);
    this.respond(runtime, message.requestId, true, undefined);
  }

  private handleRouterAdd(runtime: Runtime, message: SandboxMessage) {
    if (!message.requestId || !message.route?.path || !message.route.routeId) {
      return;
    }
    runtime.permissionGuard.assertCanUse("ui", "router.add");
    registerAddonRoute(runtime.addonId, {
      path: message.route.path,
      routeId: message.route.routeId,
      title: message.route.title,
    });
    this.respond(runtime, message.requestId, true, undefined);
  }

  private handleRouterRemove(runtime: Runtime, message: SandboxMessage) {
    if (!message.requestId || !message.routeId) {
      return;
    }
    removeAddonRoute(runtime.addonId, message.routeId);
    this.respond(runtime, message.requestId, true, undefined);
  }

  private respond(
    runtime: Runtime,
    requestId: string,
    ok: boolean,
    result?: unknown,
    error?: unknown,
  ) {
    this.post(runtime, "rpcResponse", {
      error: formatUnknownError(error),
      ok,
      requestId,
      result,
    });
  }

  private post(runtime: Runtime, type: string, payload: Record<string, unknown> = {}) {
    runtime.iframe.contentWindow?.postMessage(
      {
        addonId: runtime.addonId,
        channel: CHANNEL,
        nonce: runtime.nonce,
        type,
        ...payload,
      },
      "*",
    );
  }

  private renderActiveRoute(runtime: Runtime) {
    if (!runtime.isLoaded || !runtime.activeContainer || !runtime.activeRoute) {
      return;
    }

    if (runtime.routeRenderTimer) {
      clearTimeout(runtime.routeRenderTimer);
    }

    runtime.routeRenderTimer = window.setTimeout(() => {
      if (!runtime.isLoaded || !runtime.activeContainer || !runtime.activeRoute) {
        return;
      }
      this.post(runtime, "renderRoute", runtime.activeRoute);
    }, 0);
  }
}

export const addonIframeManager = new AddonIframeManager();
