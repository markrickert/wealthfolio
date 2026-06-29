import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@wealthfolio/ui/components/ui/alert-dialog";
import { Badge } from "@wealthfolio/ui/components/ui/badge";
import { Button } from "@wealthfolio/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui/components/ui/card";
import { FacetedFilter } from "@wealthfolio/ui/components/ui/faceted-filter";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wealthfolio/ui/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAccessTokens } from "../hooks/use-access-tokens";
import { useAgentAudit } from "../hooks/use-agent-audit";

const PAGE_SIZE = 25;

const ACTOR_LABEL: Record<string, string> = {
  pat: "Token",
};

const OUTCOME_OPTIONS = [
  { label: "Success", value: "success" },
  { label: "Denied", value: "denied" },
  { label: "Error", value: "error" },
];

function outcomeVariant(outcome: string): "success" | "warning" | "destructive" | "secondary" {
  switch (outcome) {
    case "success":
      return "success";
    case "denied":
      return "warning";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

export function AuditLogTable({ disabledNotice }: { disabledNotice?: string }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [tools, setTools] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Set<string>>(new Set());
  const [purgeOpen, setPurgeOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);

  const { items, totalCount, availableTools, isLoading, purgeMutation } = useAgentAudit({
    page,
    pageSize: PAGE_SIZE,
    q: debouncedSearch.trim() || undefined,
    tools: Array.from(tools),
    outcomes: Array.from(outcomes),
  });

  const { tokens } = useAccessTokens();
  const nameByFingerprint = useMemo(
    () => new Map(tokens.map((token) => [token.fingerprint, token.name] as const)),
    [tokens],
  );

  const toolOptions = useMemo(
    () => availableTools.map((tool) => ({ label: tool, value: tool })),
    [availableTools],
  );

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = debouncedSearch.trim().length > 0 || tools.size > 0 || outcomes.size > 0;
  // `availableTools` spans the whole log regardless of the active filter.
  const logHasData = availableTools.length > 0;

  // Any filter change returns to the first page.
  const onFilter = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <Card className="rounded-lg">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-6 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold tracking-tight">Agent activity</CardTitle>
          <CardDescription className="text-xs">
            Recent tool calls made by connected agents.
          </CardDescription>
        </div>
        {logHasData && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={purgeMutation.isPending}
            onClick={() => setPurgeOpen(true)}
          >
            <Icons.Trash2 className="h-3.5 w-3.5" />
            Clear log
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 p-6 pt-0">
        {disabledNotice && (
          <p className="text-muted-foreground bg-muted/50 flex items-center gap-2 rounded-md px-3 py-2 text-xs">
            <Icons.Info className="h-4 w-4 shrink-0" aria-hidden />
            {disabledNotice}
          </p>
        )}

        {(logHasData || hasFilters) && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[150px] lg:w-[250px]">
              <Icons.Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(event) => onFilter(setSearch, event.target.value)}
                placeholder="Search tool…"
                className="shadow-inner-xs bg-muted/90 hover:bg-muted/80 placeholder:text-muted-foreground focus:ring-ring/50 h-8 w-full rounded-md pl-8 pr-3 text-sm outline-none transition-colors focus:ring-2"
              />
            </div>
            <FacetedFilter
              title="Tool"
              options={toolOptions}
              selectedValues={tools}
              onFilterChange={(value) => onFilter(setTools, value)}
            />
            <FacetedFilter
              title="Outcome"
              options={OUTCOME_OPTIONS}
              selectedValues={outcomes}
              onFilterChange={(value) => onFilter(setOutcomes, value)}
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-8"
                onClick={() => {
                  setSearch("");
                  setTools(new Set());
                  setOutcomes(new Set());
                  setPage(1);
                }}
              >
                Reset
              </Button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {hasFilters ? "No entries match these filters." : "No agent activity recorded yet."}
          </p>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Actor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                        {format(new Date(entry.createdAt), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.tool}</TableCell>
                      <TableCell>
                        <Badge
                          variant={outcomeVariant(entry.outcome)}
                          title={entry.errorMessage ?? undefined}
                        >
                          {entry.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs" title={entry.actorFingerprint}>
                        {nameByFingerprint.get(entry.actorFingerprint) ??
                          ACTOR_LABEL[entry.actorKind] ??
                          entry.actorKind}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs">
                Page {page} of {pageCount} · {totalCount} {totalCount === 1 ? "entry" : "entries"}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <Icons.ChevronLeft className="h-4 w-4" />
                  <span className="sr-only">Previous page</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                >
                  <Icons.ChevronRight className="h-4 w-4" />
                  <span className="sr-only">Next page</span>
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear audit log?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every agent activity entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={purgeMutation.isPending}
              onClick={() => {
                purgeMutation.mutate(undefined, {
                  onSuccess: () => {
                    setPurgeOpen(false);
                    setPage(1);
                  },
                });
              }}
            >
              <Icons.Trash className="mr-2 h-4 w-4" />
              Clear log
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
