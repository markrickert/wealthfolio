import { reloadAllAddons } from "@/addons/addons-core";
import { clearAddonStaging, downloadAddonForReview, installFromStaging } from "@/adapters";
import type { ExtractedAddon } from "@/adapters";
import { ExternalLink } from "@/components/external-link";
import { Badge } from "@wealthfolio/ui/components/ui/badge";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { useToast } from "@wealthfolio/ui/components/ui/use-toast";
import type { AddonUpdateInfo, Permission, RiskLevel } from "@wealthfolio/addon-sdk";
import { useState } from "react";
import { PermissionDialog } from "./addon-permission-dialog";

interface AddonUpdateCardProps {
  addonId: string;
  addonName: string;
  updateInfo: AddonUpdateInfo;
  onUpdateComplete?: () => void;
  disabled?: boolean;
  enableAfterInstall?: boolean;
  approvedNetworkHosts?: string[];
}

export function AddonUpdateCard({
  addonId,
  addonName,
  updateInfo,
  onUpdateComplete,
  disabled = false,
  enableAfterInstall = true,
  approvedNetworkHosts = [],
}: AddonUpdateCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [permissionReview, setPermissionReview] = useState<{
    open: boolean;
    addon?: ExtractedAddon;
    permissions: Permission[];
    riskLevel: RiskLevel;
  }>({
    open: false,
    permissions: [],
    riskLevel: "low",
  });
  const { toast } = useToast();
  const addonDetailUrl = `https://wealthfolio.app/addons/${encodeURIComponent(addonId)}`;

  const calculateRiskLevel = (permissions: Permission[]): RiskLevel => {
    const hasHighRiskCategories = permissions.some((perm) =>
      ["accounts", "activities", "settings"].includes(perm.category),
    );
    const hasMediumRiskCategories = permissions.some((perm) =>
      ["portfolio", "files", "financial-planning"].includes(perm.category),
    );

    return hasHighRiskCategories ? "high" : hasMediumRiskCategories ? "medium" : "low";
  };

  const withCurrentNetworkApprovals = (extractedAddon: ExtractedAddon): ExtractedAddon => {
    const allowedHosts = extractedAddon.metadata.network?.allowedHosts ?? [];
    if (!extractedAddon.metadata.network) {
      return extractedAddon;
    }
    return {
      ...extractedAddon,
      metadata: {
        ...extractedAddon.metadata,
        network: {
          ...extractedAddon.metadata.network,
          approvedHosts: approvedNetworkHosts.filter((host) => allowedHosts.includes(host)),
        },
      },
    };
  };

  const handleUpdate = async () => {
    if (!updateInfo.downloadUrl) {
      toast({
        title: "Update not available",
        description: "No download URL available for this update.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsUpdating(true);

      const extractedAddon = withCurrentNetworkApprovals(await downloadAddonForReview(addonId));
      const permissions = extractedAddon.metadata.permissions || [];
      setPermissionReview({
        open: true,
        addon: extractedAddon,
        permissions,
        riskLevel: calculateRiskLevel(permissions),
      });
    } catch (error) {
      console.error("Error preparing addon update:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Failed to prepare addon update",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleApproveUpdate = async (approvedHosts: string[]) => {
    try {
      setPermissionReview((current) => ({ ...current, open: false }));
      setIsUpdating(true);

      await installFromStaging(addonId, enableAfterInstall, approvedHosts);
      await reloadAllAddons();

      toast({
        title: "Update successful",
        description: `${addonName} has been updated to version ${updateInfo.latestVersion}.`,
      });

      onUpdateComplete?.();
    } catch (error) {
      console.error("Error updating addon:", error);
      try {
        await clearAddonStaging(addonId);
      } catch (cleanupError) {
        console.error("Failed to clear staging after update failure:", cleanupError);
      }
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Failed to update addon",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDenyUpdate = async () => {
    setPermissionReview({ open: false, permissions: [], riskLevel: "low" });
    try {
      await clearAddonStaging(addonId);
    } catch (error) {
      console.error("Failed to clear staging after update denial:", error);
    }
  };

  const handleReviewOpenChange = (open: boolean) => {
    if (!open && permissionReview.open) {
      void handleDenyUpdate();
      return;
    }
    setPermissionReview((current) => ({ ...current, open }));
  };

  const getUpdateBadgeVariant = () => {
    if (updateInfo.isCritical) return "destructive";
    if (updateInfo.hasBreakingChanges) return "secondary";
    return "default";
  };

  const getUpdateBadgeText = () => {
    if (updateInfo.isCritical) return "Critical Update";
    if (updateInfo.hasBreakingChanges) return "Breaking Changes";
    return null; // Don't show badge for regular updates
  };

  if (!updateInfo.updateAvailable) {
    return null;
  }

  return (
    <>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Icons.ArrowUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h4 className="font-medium text-amber-900 dark:text-amber-100">Update Available</h4>
              {getUpdateBadgeText() && (
                <Badge variant={getUpdateBadgeVariant()} className="text-xs">
                  {getUpdateBadgeText()}
                </Badge>
              )}
            </div>

            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p>
                {updateInfo.currentVersion} →{" "}
                <span className="font-medium">{updateInfo.latestVersion}</span>
              </p>
              {updateInfo.releaseDate && (
                <p className="text-xs opacity-80">
                  Released: {new Date(updateInfo.releaseDate).toLocaleDateString()}
                </p>
              )}
            </div>

            {updateInfo.releaseNotes && (
              <p className="line-clamp-2 text-sm text-amber-700 dark:text-amber-300">
                {updateInfo.releaseNotes}
              </p>
            )}
          </div>

          <div className="ml-4 flex items-center gap-2">
            {(updateInfo.releaseNotes || updateInfo.changelogUrl) && (
              <Button variant="ghost" size="sm" asChild>
                <ExternalLink href={addonDetailUrl}>
                  <span className="inline-flex items-center">
                    <Icons.FileText className="mr-1 h-3 w-3" />
                    Release Notes
                  </span>
                </ExternalLink>
              </Button>
            )}

            <Button onClick={handleUpdate} disabled={isUpdating || disabled} size="sm">
              {isUpdating ? (
                <>
                  <Icons.Loader className="mr-1 h-3 w-3 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Icons.Download className="mr-1 h-3 w-3" />
                  Update
                </>
              )}
            </Button>
          </div>
        </div>

        {updateInfo.minWealthfolioVersion && (
          <div className="mt-3 rounded-md bg-amber-100 p-2 dark:bg-amber-900/20">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              <Icons.Info className="mr-1 inline h-3 w-3" />
              Requires Wealthfolio {updateInfo.minWealthfolioVersion} or later
            </p>
          </div>
        )}
      </div>

      <PermissionDialog
        open={permissionReview.open}
        onOpenChange={handleReviewOpenChange}
        manifest={permissionReview.addon?.metadata}
        declaredPermissions={permissionReview.permissions}
        riskLevel={permissionReview.riskLevel}
        onApprove={handleApproveUpdate}
        onDeny={handleDenyUpdate}
      />
    </>
  );
}
