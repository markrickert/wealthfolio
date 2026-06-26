import { getAgentAccessStatus, isDesktop, isWeb } from "@/adapters";
import { usePlatform } from "@/hooks/use-platform";
import { QueryKeys } from "@/lib/query-keys";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@wealthfolio/ui/components/ui/alert";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { EmptyPlaceholder } from "@wealthfolio/ui/components/ui/empty-placeholder";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Separator } from "@wealthfolio/ui/components/ui/separator";
import { SettingsHeader } from "../settings-header";
import { AuditLogTable } from "./components/audit-log-table";
import { McpModuleCard } from "./components/mcp-module-card";
import { McpServerCard } from "./components/mcp-server-card";
import { PatTable } from "./components/pat-table";
import { useMcpServer } from "./hooks/use-mcp-server";

function DesktopAgentAccess() {
  const { status } = useMcpServer();
  const serverUrl =
    status?.running && status.port ? `http://127.0.0.1:${status.port}/mcp` : undefined;

  return (
    <>
      <McpModuleCard />
      {status?.enabled && (
        <>
          <McpServerCard />
          <PatTable serverUrl={serverUrl} />
          <AuditLogTable
            disabledNotice={
              !status.auditEnabled
                ? "Audit logging is off — new activity will not be recorded."
                : undefined
            }
          />
        </>
      )}
    </>
  );
}

function WebAgentAccess() {
  const {
    data: status,
    isError,
    refetch,
  } = useQuery({
    queryKey: [QueryKeys.AGENT_ACCESS_STATUS],
    queryFn: getAgentAccessStatus,
    enabled: isWeb,
  });

  // Full URL (origin + endpoint) for copy-paste configs; endpoint is relative.
  const serverUrl =
    status?.mcpEnabled && typeof window !== "undefined"
      ? new URL(status.endpoint, window.location.origin).toString()
      : undefined;

  return (
    <>
      {isError && (
        <Alert variant="destructive">
          <Icons.AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load MCP status</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>Could not check whether the MCP endpoint is enabled on this server.</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {status && (
        <Alert variant={status.mcpEnabled ? "default" : "destructive"}>
          <Icons.Info className="h-4 w-4" />
          <AlertTitle>
            {status.mcpEnabled ? "MCP endpoint enabled" : "MCP endpoint disabled"}
          </AlertTitle>
          <AlertDescription>
            {status.mcpEnabled
              ? `MCP clients can connect to ${status.endpoint} on this server using a personal access token.`
              : "The server was started without MCP enabled. Tokens can be managed but won't work until it is enabled."}
          </AlertDescription>
        </Alert>
      )}
      <PatTable serverUrl={serverUrl} />
      <AuditLogTable
        disabledNotice={
          status && !status.auditEnabled
            ? "Audit logging is off (WF_MCP_AUDIT_ENABLED=false) — new activity will not be recorded."
            : undefined
        }
      />
    </>
  );
}

export default function AgentAccessPage() {
  const { isMobile, loading } = usePlatform();

  return (
    <div className="space-y-6">
      <SettingsHeader
        heading="Agent Access"
        text="Let AI agents access your portfolio over MCP. Each token's scopes control what it can do."
      />
      <Separator />

      {loading ? null : isDesktop && isMobile ? (
        <EmptyPlaceholder>
          <EmptyPlaceholder.Icon name="Brain" />
          <EmptyPlaceholder.Title>Not available on mobile</EmptyPlaceholder.Title>
          <EmptyPlaceholder.Description>
            Agent access is managed on desktop or web.
          </EmptyPlaceholder.Description>
        </EmptyPlaceholder>
      ) : isDesktop ? (
        <DesktopAgentAccess />
      ) : (
        <WebAgentAccess />
      )}
    </div>
  );
}
