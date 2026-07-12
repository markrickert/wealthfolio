import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({
  isDesktop: true,
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn(), warn: vi.fn() },
  registerDevAddonManifest: vi.fn(),
  unregisterDevAddonManifest: vi.fn(),
}));

vi.mock("@/adapters", () => adapters);

vi.mock("@/addons/addons-core", () => ({ reloadAllAddons: vi.fn() }));

vi.mock("./contribution-registry", () => ({
  clearAddonContributions: vi.fn(),
  ingestAddonContributions: vi.fn(),
}));

const iframeManager = vi.hoisted(() => ({ startAddon: vi.fn() }));

vi.mock("./iframe/addon-iframe-manager", () => ({ addonIframeManager: iframeManager }));

const { addonDevManager } = await import("./addons-dev-mode");

const MANIFEST_JSON = JSON.stringify({ id: "dev-addon", name: "Dev Addon", version: "1.0.0" });

function mockDevServerFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("/health")) return new Response("ok", { status: 200 });
      if (url.endsWith("/addon.js")) return new Response("console.log('addon')", { status: 200 });
      if (url.endsWith("/manifest.json")) return new Response(MANIFEST_JSON, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("dev-server addon manifest sync with the network broker", () => {
  beforeEach(() => {
    adapters.isDesktop = true;
    adapters.registerDevAddonManifest.mockReset().mockResolvedValue(undefined);
    adapters.unregisterDevAddonManifest.mockReset().mockResolvedValue(undefined);
    adapters.logger.warn.mockReset();
    iframeManager.startAddon
      .mockReset()
      .mockResolvedValue({ disable: vi.fn().mockResolvedValue(undefined) });
    addonDevManager.registerDevServer({ id: "dev-addon", name: "Dev Addon", port: 3001 });
    mockDevServerFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers the dev server's manifest with the backend on load", async () => {
    const success = await addonDevManager.loadAddonFromDevServer("dev-addon");

    expect(success).toBe(true);
    expect(adapters.registerDevAddonManifest).toHaveBeenCalledWith("dev-addon", MANIFEST_JSON);
  });

  it("logs and does not fail addon load if registering the manifest fails", async () => {
    adapters.registerDevAddonManifest.mockRejectedValue(new Error("backend unavailable"));

    const success = await addonDevManager.loadAddonFromDevServer("dev-addon");

    expect(success).toBe(true);
    expect(adapters.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to sync dev addon manifest for dev-addon"),
    );
  });

  it("unregisters the manifest when dev mode is disabled", async () => {
    await addonDevManager.loadAddonFromDevServer("dev-addon");
    adapters.registerDevAddonManifest.mockClear();

    addonDevManager.disableDevMode();
    await vi.waitFor(() => {
      expect(adapters.unregisterDevAddonManifest).toHaveBeenCalledWith("dev-addon");
    });
  });
});
