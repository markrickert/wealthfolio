import { logger, getInstalledAddons, loadAddon as loadAddonRuntime } from "@/adapters";
import { getDynamicNavItems, getDynamicRoutes } from "@/addons/addons-runtime-context";
import { addonIframeManager, type AddonRuntimeHandle } from "@/addons/iframe/addon-iframe-manager";
import type { AddonManifest } from "@wealthfolio/addon-sdk";
import { HOST_DEPENDENCIES, SDK_VERSION } from "@wealthfolio/addon-sdk";

interface AddonFile {
  path: string;
  manifestPath: string;
  manifest: AddonManifest;
}

// Store loaded addons for cleanup
const loadedAddons = new Map<string, AddonRuntimeHandle>();
const loadedAddonIds = new Set<string>(); // Prevent re-loading already processed addons

/**
 * Discovers all available addons using Tauri commands
 */
async function discoverAddons(): Promise<AddonFile[]> {
  try {
    const installedAddons = await getInstalledAddons();
    const addonFiles: AddonFile[] = [];

    for (const addon of installedAddons) {
      // Create AddonFile structure from InstalledAddon
      // Note: filePath from Tauri represents the addon directory, not the specific file
      addonFiles.push({
        path: `${addon.filePath}/${addon.metadata.main}`, // Construct the main file path
        manifestPath: `${addon.filePath}/manifest.json`, // Construct manifest path
        manifest: addon.metadata,
      });
    }

    return addonFiles;
  } catch (error) {
    logger.error(`Failed to discover addons: ${String(error)}`);
    return [];
  }
}

/**
 * Validates if an addon is compatible with the current SDK version
 */
function validateAddonCompatibility(manifest: AddonManifest): boolean {
  // Be lenient in web mode: warn on mismatch but allow load.
  // Future: implement proper semver compatibility if needed.
  if (manifest.sdkVersion && manifest.sdkVersion !== SDK_VERSION) {
    logger.warn(
      `Addon ${manifest.id} declares SDK ${manifest.sdkVersion}; host is ${SDK_VERSION}. Proceeding with caution.`,
    );
  }
  for (const dependencyName of Object.keys(manifest.hostDependencies ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(HOST_DEPENDENCIES, dependencyName)) {
      logger.warn(
        `Addon ${manifest.id} declares unsupported host dependency '${dependencyName}'. It may need to bundle that package.`,
      );
    }
  }
  return true;
}

/**
 * Loads a single addon using Tauri commands
 */
async function loadAddon(addonFile: AddonFile): Promise<boolean> {
  try {
    // Check if this addon ID has already been loaded in the current session
    if (loadedAddonIds.has(addonFile.manifest.id)) {
      logger.warn(
        `Addon "${addonFile.manifest.name}" (ID: ${addonFile.manifest.id}) already loaded in this session. Skipping duplicate load.`,
      );
      // Optionally, you might want to return true if already loaded implies success for the caller
      return true;
    }

    // Validate compatibility
    if (!validateAddonCompatibility(addonFile.manifest)) {
      logger.error(`Addon ${addonFile.manifest.id} is not compatible`);
      return false;
    }

    // Load addon using Tauri command instead of direct file access
    // Load addon for runtime execution using Tauri command
    const extractedAddon = await loadAddonRuntime(addonFile.manifest.id);

    // Find the main file from the extracted addon files
    const mainFile = extractedAddon.files.find((file) => file.isMain);
    if (!mainFile) {
      logger.error(
        `Main file not found for addon ${addonFile.manifest.id}. Available files: ${extractedAddon.files.map((f) => f.name).join(", ")}`,
      );
      return false;
    }

    let addonCode = mainFile.content;

    // Strip source map references to prevent blob URL loading errors
    // Source maps can't be loaded from blob: URLs and cause console errors
    addonCode = addonCode.replace(/\/\/# sourceMappingURL=.*/g, "");

    // Extract permission data directly from manifest (already processed by Rust backend)
    const permissions = extractedAddon.metadata.permissions ?? [];
    const detectedFunctions = permissions.flatMap((p) =>
      p.functions.filter((f) => f.isDetected).map((f) => f.name),
    );
    const detectedCategories = [
      ...new Set(
        permissions
          .filter((p) => p.functions.some((f) => f.isDeclared || f.isDetected))
          .map((p) => p.category),
      ),
    ];

    logger.info(
      `Permissions for addon ${extractedAddon.metadata.id}: functions=[${detectedFunctions.join(",")}], categories=[${detectedCategories.join(",")}]`,
    );

    const handle = await addonIframeManager.startAddon({
      addonId: extractedAddon.metadata.id,
      code: addonCode,
      files: extractedAddon.files,
      manifest: extractedAddon.metadata,
      permissions,
    });

    loadedAddons.set(extractedAddon.metadata.id, handle);
    loadedAddonIds.add(extractedAddon.metadata.id); // Add to set after successful load and enablement

    return true;
  } catch (error) {
    logger.error(`Failed to load addon ${addonFile.manifest.id}: ${String(error)}`);
    return false;
  }
}

/**
 * Load installed addons (production mode)
 */
export async function loadInstalledAddons(): Promise<void> {
  const addonFiles = await discoverAddons();

  if (addonFiles.length === 0) {
    logger.info("⚠️  No addons found to load - check AppData/addons directory");
    return;
  }

  // Filter only enabled addons
  const enabledAddonFiles = addonFiles.filter((addonFile) => addonFile.manifest.enabled !== false);

  if (enabledAddonFiles.length === 0) {
    logger.info("📦 No enabled addons found to load");
    return;
  }

  let loadedCount = 0;
  const loadPromises = enabledAddonFiles.map(async (addonFile) => {
    // Each addon gets its own context, but loadAddon creates its own internally
    const success = await loadAddon(addonFile);
    if (success) {
      loadedCount++;
    } else {
      void 0;
    }
  });

  // Load all enabled addons concurrently
  await Promise.all(loadPromises);

  logger.info(
    `🎉 Successfully loaded ${loadedCount} out of ${enabledAddonFiles.length} enabled addons`,
  );

  // Debug: Show current navigation state
}

/**
 * Unloads a specific addon by ID
 */
export function unloadAddon(addonId: string): void {
  const addon = loadedAddons.get(addonId);
  if (addon) {
    try {
      void addon.disable();
      loadedAddons.delete(addonId);
      loadedAddonIds.delete(addonId);
      logger.info(`🗑️ Unloaded addon: ${addonId}`);
    } catch (error) {
      logger.error(`Error unloading addon ${addonId}: ${String(error)}`);
    }
  }
}

/**
 * Unloads all addons and cleans up resources
 */
export function unloadAllAddons(): void {
  loadedAddons.forEach((addon, id) => {
    try {
      void addon.disable();
    } catch (error) {
      logger.error(`Error unloading addon ${id}: ${String(error)}`);
    }
  });

  loadedAddons.clear();
  loadedAddonIds.clear(); // Clear the set when unloading all
}

/**
 * Gets information about currently loaded addons
 */
export function getLoadedAddons(): string[] {
  return Array.from(loadedAddons.keys());
}

/**
 * Debug function to check current addon state
 */
export function debugAddonState(): void {
  logger.info("🐛 Addon Debug Info:");
  logger.info(`- Dynamic nav items: ${JSON.stringify(getDynamicNavItems())}`);
  logger.info(`- Dynamic routes: ${JSON.stringify(getDynamicRoutes())}`);
  logger.info(`- Loaded addons: ${JSON.stringify(getLoadedAddons())}`);
}

/**
 * Reloads all addons (useful for development and settings)
 * This function dynamically imports the full plugin loader to avoid circular dependencies
 */
export async function reloadAllAddons(): Promise<void> {
  unloadAllAddons();

  // Dynamically import the full plugin loader to avoid importing dev mode
  const { loadAllAddons } = await import("./addons-loader");
  await loadAllAddons();
}
