import "@/globals.css";

import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import {
  createHostDependencyModuleUrl,
  isHostDependencySpecifier,
} from "./host-dependencies";

const CHANNEL = "wealthfolio:addon-sandbox:v1";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface RouteLocation {
  pathname: string;
  search: string;
  hash: string;
  params: Record<string, string | undefined>;
}

interface RouteRenderContext {
  root: HTMLElement;
  location: RouteLocation;
}

interface LegacyRouteConfig {
  id?: unknown;
  path?: unknown;
  title?: unknown;
  render?: unknown;
  component?: unknown;
}

interface SandboxAddonFile {
  name: string;
  content: string;
  isMain?: boolean;
}

interface SandboxMessage {
  channel?: string;
  addonId?: string;
  nonce?: string;
  type?: string;
  requestId?: string;
  code?: string;
  files?: SandboxAddonFile[];
  routeId?: string;
  location?: RouteLocation;
  ok?: boolean;
  result?: unknown;
  error?: string;
  subscriptionId?: string;
  payload?: unknown;
}

type RouteRenderer = (context: RouteRenderContext) => Promise<void> | void;
type ModuleSpecifierResolver = (importerPath: string, specifier: string) => string;

const init = new URLSearchParams(window.location.hash.slice(1));
const ADDON_ID = init.get("addonId") ?? "";
const NONCE = init.get("nonce") ?? "";
const rootElement = document.getElementById("addon-root");
const routes = new Map<string, RouteRenderer>();
const pending = new Map<string, PendingCall>();
const disableCallbacks = new Set<() => Promise<void> | void>();
const eventCallbacks = new Map<string, (payload: unknown) => void>();
let addonDisable: (() => Promise<void> | void) | undefined;
let addonCodeUrl: string | undefined;
let addonQueryClient: QueryClient | undefined;
let addonModuleUrls = new Map<string, string>();
let reactRouteRoot: ReactDOMClient.Root | undefined;

if (!ADDON_ID || !NONCE || !rootElement) {
  throw new Error("Invalid addon sandbox bootstrap parameters");
}

const root = rootElement;

function post(type: string, payload: Record<string, unknown> = {}) {
  parent.postMessage({ channel: CHANNEL, addonId: ADDON_ID, nonce: NONCE, type, ...payload }, "*");
}

function callHost(type: string, payload: Record<string, unknown> = {}) {
  const requestId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    post(type, { requestId, ...payload });
  });
}

function normalizeModulePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function dirname(path: string) {
  const normalizedPath = normalizeModulePath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? "" : normalizedPath.slice(0, index);
}

function resolveModulePath(importerPath: string, specifier: string) {
  const normalizedSpecifier = normalizeModulePath(specifier);
  if (!normalizedSpecifier.startsWith(".")) {
    return normalizedSpecifier;
  }

  const basePath = dirname(importerPath);
  const parts = `${basePath}/${normalizedSpecifier}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

function stripSourceMapReferences(code: string) {
  return code.replace(/\/\/# sourceMappingURL=.*/g, "");
}

function getModuleBasename(path: string) {
  const normalizedPath = normalizeModulePath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? normalizedPath : normalizedPath.slice(index + 1);
}

function createAddonModuleRegistry(code: string, files: SandboxAddonFile[] = []) {
  const sources = new Map<string, { path: string; source: string }>();
  const mainFile = files.find((file) => file.isMain) ?? files.find((file) => file.content === code);
  const mainPath = normalizeModulePath(mainFile?.name ?? "addon.js");

  for (const file of files) {
    if (!file.name.endsWith(".js")) {
      continue;
    }
    const path = normalizeModulePath(file.name);
    const source = stripSourceMapReferences(file.content);
    sources.set(path, { path, source });
    sources.set(getModuleBasename(path), { path, source });
  }

  sources.set(mainPath, { path: mainPath, source: stripSourceMapReferences(code) });

  const objectUrls = new Map<string, string>();
  const resolveModuleSpecifier = (importerPath: string, specifier: string) => {
    const hostModuleUrl = createHostDependencyModuleUrl(specifier, objectUrls);
    if (hostModuleUrl) {
      return hostModuleUrl;
    }

    const resolvedPath = resolveModulePath(importerPath, specifier);
    const moduleEntry = sources.get(resolvedPath) ?? sources.get(getModuleBasename(resolvedPath));
    if (!moduleEntry) {
      return specifier;
    }

    const urlKey = sources.has(resolvedPath) ? resolvedPath : getModuleBasename(resolvedPath);
    let moduleUrl = objectUrls.get(urlKey);
    if (!moduleUrl) {
      moduleUrl = URL.createObjectURL(
        new Blob(
          [rewriteModuleSpecifiers(moduleEntry.path, moduleEntry.source, resolveModuleSpecifier)],
          {
            type: "text/javascript",
          },
        ),
      );
      objectUrls.set(urlKey, moduleUrl);
    }
    return moduleUrl;
  };

  const importModule = (importerPath: string, specifier: string) => {
    return import(/* @vite-ignore */ resolveModuleSpecifier(importerPath, specifier));
  };

  Object.assign(globalThis, {
    __wealthfolioImport: importModule,
  });

  return {
    mainPath,
    mainUrl: resolveModuleSpecifier(mainPath, mainPath),
    objectUrls,
  };
}

function rewriteStaticImportSpecifiers(
  importerPath: string,
  code: string,
  resolveSpecifier: ModuleSpecifierResolver,
) {
  return code.replace(
    /(\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?)(["'])([^"']+)\2/g,
    (match, prefix: string, quote: string, specifier: string) => {
      if (!isHostDependencySpecifier(specifier) && !specifier.startsWith(".")) {
        return match;
      }
      return `${prefix}${quote}${resolveSpecifier(importerPath, specifier)}${quote}`;
    },
  );
}

function rewriteModuleSpecifiers(
  importerPath: string,
  code: string,
  resolveSpecifier: ModuleSpecifierResolver,
) {
  const withStaticImports = rewriteStaticImportSpecifiers(importerPath, code, resolveSpecifier);

  return withStaticImports.replace(
    /\bimport\s*\(/g,
    `globalThis.__wealthfolioImport(${JSON.stringify(importerPath)}, `,
  );
}

function findAnchor(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLAnchorElement>("a[href]");
}

function toInternalRoute(rawHref: string) {
  if (!rawHref || rawHref.startsWith("#")) {
    return null;
  }

  const currentUrl = new URL(window.location.href);
  const targetUrl = new URL(rawHref, currentUrl);
  if (targetUrl.origin !== currentUrl.origin) {
    return null;
  }

  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const anchor = findAnchor(event.target);
  if (!anchor || anchor.hasAttribute("download")) {
    return;
  }
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") {
    return;
  }

  const route = toInternalRoute(anchor.getAttribute("href") ?? "");
  if (!route || route.startsWith("/addon-sandbox.html")) {
    return;
  }

  event.preventDefault();
  callHost("api", { method: "navigation.navigate", args: [route] }).catch((error: unknown) =>
    console.error(error),
  );
});

function assertCloneable(value: unknown) {
  if (typeof structuredClone !== "function") {
    return;
  }
  structuredClone(value);
}

function toHostQueryKey(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }

  if (typeof value === "object" && value !== null && "queryKey" in value) {
    return toHostQueryKey((value as { queryKey?: unknown }).queryKey);
  }

  return undefined;
}

function mirrorHostQueryCall(
  method: "query.invalidateQueries" | "query.refetchQueries",
  args: unknown[],
) {
  const queryKey = toHostQueryKey(args[0]);
  if (!queryKey) {
    return;
  }

  callHost("api", { method, args: [queryKey] }).catch((error: unknown) => console.error(error));
}

function getAddonQueryClient() {
  if (!addonQueryClient) {
    addonQueryClient = new QueryClient();
    const client = addonQueryClient as unknown as {
      invalidateQueries: (...args: unknown[]) => Promise<unknown>;
      refetchQueries: (...args: unknown[]) => Promise<unknown>;
    };
    const invalidateQueries = client.invalidateQueries.bind(client);
    const refetchQueries = client.refetchQueries.bind(client);

    client.invalidateQueries = (...args: unknown[]) => {
      mirrorHostQueryCall("query.invalidateQueries", args);
      return invalidateQueries(...args);
    };
    client.refetchQueries = (...args: unknown[]) => {
      mirrorHostQueryCall("query.refetchQueries", args);
      return refetchQueries(...args);
    };
  }

  return addonQueryClient;
}

function createApiProxy(path: string[] = []): unknown {
  return new Proxy(function addonApiProxy() {}, {
    get(_target, key) {
      if (key === "then" || typeof key === "symbol") {
        return undefined;
      }
      return createApiProxy([...path, String(key)]);
    },
    apply(_target, _thisArg, args: unknown[]) {
      const method = path.join(".");
      if (method === "query.getClient") {
        return getAddonQueryClient();
      }
      if (method.startsWith("events.") && typeof args[0] === "function") {
        const callback = args[0] as (payload: unknown) => void;
        return callHost("eventSubscribe", { method }).then((value) => {
          const { subscriptionId } = value as { subscriptionId: string };
          eventCallbacks.set(subscriptionId, callback);
          return () => {
            eventCallbacks.delete(subscriptionId);
            return callHost("eventUnsubscribe", { subscriptionId });
          };
        });
      }
      assertCloneable(args);
      const result = callHost("api", { method, args });
      if (method.startsWith("logger.") || method.startsWith("toast.")) {
        result.catch((error: unknown) => console.error(error));
        return undefined;
      }
      return result;
    },
  });
}

function createReactRouteRenderer(component: unknown): RouteRenderer {
  return ({ root: routeRoot }) => {
    const Component = component as React.ElementType;
    reactRouteRoot ??= ReactDOMClient.createRoot(routeRoot);
    const reactRoot = reactRouteRoot;
    reactRoot.render(
      React.createElement(
        React.Suspense,
        { fallback: React.createElement("div", null, "Loading add-on...") },
        React.createElement(Component),
      ),
    );
  };
}

function unmountReactRouteRoot() {
  if (!reactRouteRoot) {
    return;
  }
  reactRouteRoot.unmount();
  reactRouteRoot = undefined;
}

function normalizeRoute(route: LegacyRouteConfig) {
  const path = String(route.path || "");
  const routeId = String(route.id || path || crypto.randomUUID?.() || "");
  return {
    path,
    routeId,
    title: typeof route.title === "string" ? route.title : undefined,
  };
}

function createContext() {
  return {
    ui: { root },
    sidebar: {
      addItem(cfg: Record<string, unknown>) {
        const item = {
          id: String(cfg?.id ?? ""),
          label: String(cfg?.label ?? ""),
          icon: typeof cfg?.icon === "string" ? cfg.icon : undefined,
          route: typeof cfg?.route === "string" ? cfg.route : undefined,
          order: typeof cfg?.order === "number" ? cfg.order : undefined,
        };
        callHost("sidebar.addItem", { item }).catch((error: unknown) => console.error(error));
        return {
          remove() {
            return callHost("sidebar.removeItem", { itemId: item.id });
          },
        };
      },
    },
    router: {
      add(route: LegacyRouteConfig) {
        const normalizedRoute = normalizeRoute(route);
        if (typeof route?.render === "function") {
          routes.set(normalizedRoute.routeId, async (context) => {
            unmountReactRouteRoot();
            await (route.render as RouteRenderer)(context);
          });
        } else if (route?.component) {
          routes.set(normalizedRoute.routeId, createReactRouteRenderer(route.component));
        } else {
          throw new Error("Sandboxed addon routes must provide render(context) or component");
        }
        callHost("router.add", { route: normalizedRoute }).catch((error: unknown) =>
          console.error(error),
        );
      },
    },
    onDisable(callback: unknown) {
      if (typeof callback === "function") {
        disableCallbacks.add(callback as () => Promise<void> | void);
      }
    },
    api: createApiProxy(),
  };
}

function resolveEnable(mod: Record<string, unknown>) {
  const defaultExport = mod?.default;
  if (typeof defaultExport === "function") {
    return defaultExport;
  }
  if (
    defaultExport &&
    typeof defaultExport === "object" &&
    typeof (defaultExport as { enable?: unknown }).enable === "function"
  ) {
    return (defaultExport as { enable: unknown }).enable;
  }
  if (typeof mod?.enable === "function") {
    return mod.enable;
  }
  if (typeof mod?.PortfolioTrackerAddon === "function") {
    return mod.PortfolioTrackerAddon;
  }
  return null;
}

async function loadAddon(code: string, files: SandboxAddonFile[] = []) {
  const moduleRegistry = createAddonModuleRegistry(code, files);
  addonModuleUrls = moduleRegistry.objectUrls;
  addonCodeUrl = moduleRegistry.mainUrl;
  const mod = (await import(/* @vite-ignore */ addonCodeUrl)) as Record<string, unknown>;
  const enable = resolveEnable(mod);
  if (!enable) {
    throw new Error("Addon does not export an enable(context) function");
  }
  const result = await (enable as (context: unknown) => Promise<unknown> | unknown)(createContext());
  addonDisable =
    result &&
    typeof result === "object" &&
    typeof (result as { disable?: unknown }).disable === "function"
      ? ((result as { disable: () => Promise<void> | void }).disable)
      : undefined;
}

async function renderRoute(routeId: string, location: RouteLocation) {
  const route = routes.get(routeId);
  if (!route) {
    unmountReactRouteRoot();
    root.textContent = "Addon route is not available.";
    return;
  }
  await route({ root, location });
}

async function disableAddon() {
  for (const callback of Array.from(disableCallbacks).reverse()) {
    await callback();
  }
  disableCallbacks.clear();
  if (addonDisable) {
    await addonDisable();
    addonDisable = undefined;
  }
  unmountReactRouteRoot();
  routes.clear();
  eventCallbacks.clear();
  addonQueryClient?.clear();
  addonQueryClient = undefined;
  const mainModuleUrl = addonCodeUrl;
  if (addonCodeUrl) {
    URL.revokeObjectURL(addonCodeUrl);
    addonCodeUrl = undefined;
  }
  for (const moduleUrl of addonModuleUrls.values()) {
    if (moduleUrl !== mainModuleUrl) {
      URL.revokeObjectURL(moduleUrl);
    }
  }
  addonModuleUrls.clear();
  root.replaceChildren();
}

window.addEventListener("error", (event) => {
  post("runtimeError", { error: event.message || String(event.error) });
});

window.addEventListener("unhandledrejection", (event) => {
  post("runtimeError", { error: String(event.reason) });
});

window.addEventListener("message", (event: MessageEvent<SandboxMessage>) => {
  const message = event.data;
  if (
    !message ||
    message.channel !== CHANNEL ||
    message.addonId !== ADDON_ID ||
    message.nonce !== NONCE
  ) {
    return;
  }

  if (message.type === "rpcResponse") {
    const callbacks = pending.get(message.requestId ?? "");
    if (!callbacks) {
      return;
    }
    pending.delete(message.requestId ?? "");
    if (message.ok) {
      callbacks.resolve(message.result);
    } else {
      callbacks.reject(new Error(message.error || "Addon host call failed"));
    }
    return;
  }

  if (message.type === "event") {
    const callback = eventCallbacks.get(message.subscriptionId ?? "");
    if (callback) {
      callback(message.payload);
    }
    return;
  }

  void (async () => {
    try {
      if (message.type === "loadAddon" && typeof message.code === "string") {
        await loadAddon(message.code, message.files);
        post("loaded");
      } else if (message.type === "renderRoute" && message.routeId && message.location) {
        await renderRoute(message.routeId, message.location);
      } else if (message.type === "disable") {
        await disableAddon();
        post("disabled");
      }
    } catch (error) {
      post("loadError", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});

post("ready");
