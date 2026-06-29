import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@wealthfolio/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui/components/ui/card";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Label } from "@wealthfolio/ui/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import { Switch } from "@wealthfolio/ui/components/ui/switch";
import { toast } from "@wealthfolio/ui/components/ui/use-toast";
import { buildClientConfig, STANDARD_PRESET_ID, TOKEN_PLACEHOLDER } from "../mcp-client-config";
import { useMcpServer } from "../hooks/use-mcp-server";

/** Icon button that copies `value` and briefly shows a check. */
function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy failed",
        description: `Could not copy ${label.toLowerCase()}.`,
        variant: "destructive",
      });
      console.error("Failed to copy to clipboard:", error);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={() => void handleCopy()}
    >
      {copied ? (
        <Icons.Check className="text-success h-3.5 w-3.5" />
      ) : (
        <Icons.Copy className="h-3.5 w-3.5" />
      )}
      <span className="sr-only">Copy {label}</span>
    </Button>
  );
}

/** Labeled button that copies the standard client config JSON (token placeholder). */
function CopyConfigButton({ serverUrl }: { serverUrl: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildClientConfig(STANDARD_PRESET_ID, serverUrl));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied", description: "Client config copied to clipboard." });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy client config.",
        variant: "destructive",
      });
      console.error("Failed to copy to clipboard:", error);
    }
  };
  return (
    <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void handleCopy()}>
      {copied ? (
        <Icons.Check className="text-success h-3.5 w-3.5" />
      ) : (
        <Icons.Copy className="h-3.5 w-3.5" />
      )}
      Copy config
    </Button>
  );
}

/** Help popover: how to connect, the standard config, and the clients that differ. */
function ConnectHelp({ serverUrl }: { serverUrl: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
          <Icons.HelpCircle className="text-muted-foreground h-4 w-4" />
          <span className="sr-only">How to connect a client</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-96 space-y-3 overflow-auto text-sm">
        <div className="space-y-1">
          <p className="font-medium">Connect an MCP client</p>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
            <li>Enable the server above.</li>
            <li>
              Create an access token below and choose its scopes — copy it once; it is shown only at
              creation.
            </li>
            <li>
              Add the config to your agent, replacing{" "}
              <span className="font-mono">{TOKEN_PLACEHOLDER}</span> with that token.
            </li>
          </ol>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            Standard config — Claude Desktop, Claude Code, Cursor, Windsurf, Cline
          </p>
          <pre className="bg-muted text-muted-foreground overflow-auto rounded-md p-2 font-mono text-[11px] leading-snug">
            {buildClientConfig(STANDARD_PRESET_ID, serverUrl)}
          </pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">VS Code — uses a top-level `servers` key</p>
          <pre className="bg-muted text-muted-foreground overflow-auto rounded-md p-2 font-mono text-[11px] leading-snug">
            {buildClientConfig("vscode", serverUrl)}
          </pre>
        </div>
        <p className="text-muted-foreground text-xs">
          Jan and other HTTP clients: point them at the URL above with an{" "}
          <span className="font-mono">Authorization: Bearer {TOKEN_PLACEHOLDER}</span> header.
        </p>
        <div className="space-y-1">
          <p className="text-xs font-medium">Config file locations</p>
          <ul className="text-muted-foreground space-y-0.5 text-xs">
            <li>Claude Desktop — Settings → Developer → Edit Config</li>
            <li>
              Cursor — <span className="font-mono">~/.cursor/mcp.json</span>
            </li>
            <li>
              VS Code — <span className="font-mono">.vscode/mcp.json</span>
            </li>
            <li>
              Windsurf — <span className="font-mono">~/.codeium/windsurf/mcp_config.json</span>
            </li>
            <li>
              Claude Code — <span className="font-mono">.mcp.json</span> in your project
            </li>
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A bordered setting row: icon chip + title/description + a success-green switch. */
function SettingRow({
  icon,
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: ReactNode;
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="border-border bg-muted/30 grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-md border px-4 py-3.5">
      <div className="border-border bg-background text-foreground flex h-8 w-8 items-center justify-center rounded-md border">
        {icon}
      </div>
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>
      <Switch
        id={id}
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="data-[state=checked]:bg-success data-[state=unchecked]:bg-muted-foreground/40"
      />
    </div>
  );
}

export function McpServerCard() {
  const {
    status,
    isLoading,
    isError,
    refetchStatus,
    setAutoStartMutation,
    startMutation,
    stopMutation,
    setAuditEnabledMutation,
  } = useMcpServer();

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Icons.AlertTriangle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-muted-foreground text-sm">Failed to load the MCP server status.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetchStatus()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </CardContent>
      </Card>
    );
  }

  const serverUrl =
    status.running && status.port ? `http://127.0.0.1:${status.port}/mcp` : undefined;

  return (
    <Card className="rounded-lg">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-6 pb-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                status.running ? "bg-success" : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            <CardTitle className="text-base font-semibold tracking-tight">MCP server</CardTitle>
          </div>
          {serverUrl ? (
            <CardDescription className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="shrink-0">Running at</span>
              <code className="bg-muted text-foreground truncate rounded px-1.5 py-0.5 font-mono text-xs">
                {serverUrl}
              </code>
              <CopyIconButton value={serverUrl} label="server URL" />
            </CardDescription>
          ) : (
            <CardDescription className="text-xs">Stopped</CardDescription>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {serverUrl && <CopyConfigButton serverUrl={serverUrl} />}
          {status.running ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={stopMutation.isPending}
              onClick={() => stopMutation.mutate()}
            >
              <Icons.Square className="h-3.5 w-3.5" weight="fill" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              <Icons.PlayCircle className="h-3.5 w-3.5" weight="duotone" />
              Start
            </Button>
          )}
          {serverUrl && <ConnectHelp serverUrl={serverUrl} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-6 pt-0">
        <SettingRow
          icon={<Icons.Clock size={18} weight="duotone" />}
          id="mcp-auto-start"
          title="Start automatically with Wealthfolio"
          description="Start the server whenever the app launches."
          checked={status.autoStart}
          disabled={setAutoStartMutation.isPending}
          onCheckedChange={(checked) => setAutoStartMutation.mutate(checked)}
        />
        <SettingRow
          icon={<Icons.FileText size={18} weight="duotone" />}
          id="mcp-audit-enabled"
          title="Log agent activity"
          description="Records every agent tool call. Disable to stop writing audit rows."
          checked={status.auditEnabled}
          disabled={setAuditEnabledMutation.isPending}
          onCheckedChange={(checked) => setAuditEnabledMutation.mutate(checked)}
        />

        <p className="text-muted-foreground px-1 pt-2 text-xs">
          Stopping the server keeps tokens valid. Remove a token below to cut off access.
        </p>
      </CardContent>
    </Card>
  );
}
