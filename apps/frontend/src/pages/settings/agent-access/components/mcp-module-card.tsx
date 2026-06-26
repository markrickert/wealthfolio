import { cn } from "@/lib/utils";
import { Switch } from "@wealthfolio/ui/components/ui/switch";
import { useMcpServer } from "../hooks/use-mcp-server";

/** Master feature toggle for Agent Access — gates the rest of the page. */
export function McpModuleCard() {
  const { status, isLoading, setEnabledMutation } = useMcpServer();
  const enabled = status?.enabled ?? false;
  const running = status?.running ?? false;

  return (
    <section
      aria-label="Agent access status"
      className="bg-foreground text-background relative overflow-hidden rounded-lg shadow-lg"
    >
      <div className="p-5 sm:px-7 sm:py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-background/60 flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-widest">
            <span className="relative flex h-2 w-2 shrink-0">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-60",
                  enabled ? "animate-ping bg-green-300" : "bg-background/40",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  enabled ? "bg-green-300" : "bg-background/40",
                )}
              />
            </span>
            <span className="text-background truncate font-medium">
              {enabled
                ? running
                  ? "Agent access running"
                  : "Agent access enabled"
                : "Agent access disabled"}
            </span>
          </div>

          <label className="flex shrink-0 cursor-pointer select-none items-center gap-2">
            <span className="text-background/55 hidden text-xs font-medium uppercase tracking-widest sm:inline">
              {enabled ? "Enabled" : "Disabled"}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={(next) => setEnabledMutation.mutate(next)}
              disabled={isLoading || setEnabledMutation.isPending}
              className={cn(
                "data-[state=checked]:bg-warning data-[state=unchecked]:bg-background/15",
                "[&_[data-slot=switch-thumb]]:data-[state=checked]:bg-foreground",
                "[&_[data-slot=switch-thumb]]:data-[state=unchecked]:bg-background/40",
              )}
            />
          </label>
        </div>

        <div className="mt-4 text-sm font-medium tracking-tight sm:text-base">
          {enabled
            ? "AI agents can connect over MCP using scoped access tokens. Start the server and create a token below."
            : "Agent access is off. Enable it to let AI agents read and act on your portfolio over MCP."}
        </div>
        <div className="text-background/50 mt-2 text-xs">
          Disabling stops the server and hides agent access. Your tokens are kept but won&apos;t
          work until you re-enable.
        </div>
      </div>
    </section>
  );
}
