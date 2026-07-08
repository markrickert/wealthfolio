import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { activationCoordinator } from "@/addons/activation-coordinator";
import { addonIframeManager, type AddonRouteRenderStatus } from "./addon-iframe-manager";

interface AddonIframeRouteProps {
  addonId: string;
  routeId: string;
}

export function AddonIframeRoute({ addonId, routeId }: AddonIframeRouteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const params = useParams();
  const [routeStatus, setRouteStatus] = useState<AddonRouteRenderStatus>({ status: "idle" });
  // True once the runtime is booted, attached and subscribed; the location
  // effect below must no-op until then (attach/updateRoute throw otherwise).
  const [ready, setReady] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  // Bumped by the error-panel retry so a failed activation can be re-attempted.
  const [retryNonce, setRetryNonce] = useState(0);

  // Mount: ensure the addon runtime is activated (lazy addons boot here on
  // first visit; pinned addons already have a runtime so this resolves
  // immediately), then attach + subscribe.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setReady(false);
    setActivationError(null);

    activationCoordinator
      .activateView(addonId)
      .then((activated) => {
        // Ignore a resolution that lands after the effect was cleaned up
        // (unmount or addonId change) to avoid touching a torn-down runtime.
        if (cancelled) {
          return;
        }
        if (!activated) {
          setActivationError(`Failed to start add-on '${addonId}'`);
          return;
        }
        unsubscribe = addonIframeManager.subscribeRouteStatus(addonId, setRouteStatus);
        addonIframeManager.attachRoute(addonId, container);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setActivationError(`Failed to start add-on '${addonId}'`);
      });

    return () => {
      cancelled = true;
      setReady(false);
      unsubscribe?.();
      addonIframeManager.detachRoute(addonId, container);
    };
  }, [addonId, retryNonce]);

  // Render the active route on location change. No-op until the runtime is
  // ready; runs once `ready` flips true to perform the initial render.
  useLayoutEffect(() => {
    if (!ready) {
      return;
    }
    const routeLocation = {
      hash: location.hash,
      params,
      pathname: location.pathname,
      search: location.search,
    };
    setRouteStatus(addonIframeManager.getRouteStatus(addonId, routeId, routeLocation));
    addonIframeManager.updateRoute(addonId, routeId, routeLocation);
  }, [ready, addonId, routeId, location.hash, location.pathname, location.search, params]);

  const isActivating = !ready && activationError === null;
  const isColdLoading =
    isActivating || (routeStatus.status === "rendering" && routeStatus.cold);
  const errorMessage =
    activationError ?? (routeStatus.status === "error" ? routeStatus.error : undefined);
  const isError = errorMessage !== undefined;

  const handleRetry = () => {
    if (activationError !== null) {
      setActivationError(null);
      setRetryNonce((nonce) => nonce + 1);
      return;
    }
    addonIframeManager.retryRoute(addonId);
  };

  return (
    <div className="relative min-h-[calc(100vh-96px)] w-full overflow-hidden">
      <div
        ref={containerRef}
        className={cn(
          "min-h-[calc(100vh-96px)] w-full overflow-hidden transition-opacity duration-150",
          isColdLoading && "opacity-0",
        )}
        data-addon-id={addonId}
        data-addon-route-id={routeId}
      />
      {isColdLoading ? <AddonRouteSkeleton /> : null}
      {isError ? (
        <AddonRouteError addonId={addonId} error={errorMessage} onRetry={handleRetry} />
      ) : null}
    </div>
  );
}

function AddonRouteSkeleton() {
  return (
    <div
      className="bg-background text-foreground absolute inset-0 px-6 py-5"
      aria-label="Loading add-on"
      aria-live="polite"
    >
      <div className="space-y-6">
        <div className="bg-muted h-9 w-72 max-w-full animate-pulse rounded-md" />
        <div className="bg-muted h-5 w-[min(28rem,70%)] animate-pulse rounded-md" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="bg-muted/80 h-28 animate-pulse rounded-md" />
          <div className="bg-muted/80 h-28 animate-pulse rounded-md" />
          <div className="bg-muted/80 h-28 animate-pulse rounded-md" />
        </div>
        <div className="bg-muted/60 h-64 animate-pulse rounded-md" />
      </div>
    </div>
  );
}

function AddonRouteError({
  addonId,
  error,
  onRetry,
}: {
  addonId: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="bg-background/95 text-foreground absolute inset-0 px-6 py-5">
      <div className="border-border bg-card max-w-xl rounded-md border p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Add-on view failed to load</h2>
        <p className="text-muted-foreground mt-1 text-xs">{addonId}</p>
        <p className="text-muted-foreground mt-2 text-sm whitespace-pre-line">{error}</p>
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 rounded-md px-3 py-2 text-sm font-medium"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
