import { performancePeriodPnl, performanceSummaryReturn } from "@/lib/performance";
import { AccountValuation, CurrentValuationSplit, PerformanceResult } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { PerformanceGrid } from "@/pages/account/performance-grid";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  GainAmount,
  GainPercent,
  Icons,
  MoneyInput,
  PrivacyAmount,
  Separator,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@wealthfolio/ui";
import React, { useState } from "react";

import { useBalanceUpdate } from "./use-balance-update";

interface EditableBalanceProps {
  account: AccountValuation;
  initialBalance: number;
  currency: string;
}

const EditableBalance: React.FC<EditableBalanceProps> = ({ account, initialBalance, currency }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [balance, setBalance] = useState(initialBalance);
  const { updateBalance, isPending } = useBalanceUpdate(account);

  const handleSave = () => {
    updateBalance(balance);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <MoneyInput value={balance} onValueChange={(value) => setBalance(value ?? 0)} />
        <Button size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <Icons.Spinner className="h-4 w-4 animate-spin" />
          ) : (
            <Icons.Check className="h-4 w-4" />
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
          <Icons.Close className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex cursor-pointer items-center gap-2 text-lg font-extrabold"
            onClick={() => setIsEditing(true)}
          >
            <PrivacyAmount value={initialBalance} currency={currency} />
            <Icons.Pencil className="text-muted-foreground h-4 w-4 cursor-pointer" />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Click to update the cash balance</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

interface AccountMetricsProps {
  valuation?: AccountValuation | null;
  performance?: PerformanceResult | null;
  cashCurrencySplit?: CurrentValuationSplit[];
  className?: string;
  isLoading?: boolean;
  isPerformanceLoading?: boolean;
  performanceError?: string;
  /** If true, hides the inline balance edit (HOLDINGS mode accounts should use the Update Holdings sheet) */
  hideBalanceEdit?: boolean;
  balanceLabel?: string;
  /** If true, shows holdings-mode return cards instead of transaction return cards. */
  isHoldingsMode?: boolean;
  balanceWarning?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    isLoading?: boolean;
  };
}

interface CashCurrencyBreakdownProps {
  cashCurrencySplit?: CurrentValuationSplit[];
  displayCurrency: string;
}

function CashCurrencyBreakdown({ cashCurrencySplit, displayCurrency }: CashCurrencyBreakdownProps) {
  const rows =
    cashCurrencySplit?.filter((split) => Math.abs(split.valueLocal ?? split.valueBase) > 0) ?? [];

  if (rows.length <= 1) return null;

  const visibleRows = rows.slice(0, 4);
  const remainingCount = rows.length - visibleRows.length;

  return (
    <div className="text-muted-foreground -mt-2 flex flex-wrap items-center justify-end gap-1 text-right text-[10px]">
      {visibleRows.map((split) => {
        const value = split.valueLocal ?? split.valueBase;
        const currency = split.valueLocal == null ? displayCurrency : split.currency;

        return (
          <span
            key={split.currency}
            className="bg-muted/30 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 leading-none"
          >
            <span className="font-medium">{split.currency}</span>
            <PrivacyAmount value={value} currency={currency} />
          </span>
        );
      })}
      {remainingCount > 0 && <span>+{remainingCount} more</span>}
    </div>
  );
}

const AccountMetrics: React.FC<AccountMetricsProps> = ({
  valuation,
  performance,
  cashCurrencySplit,
  className,
  isLoading,
  isPerformanceLoading,
  performanceError,
  hideBalanceEdit = false,
  balanceLabel = "Cash Balance",
  isHoldingsMode = false,
  balanceWarning,
}) => {
  // Full skeleton only when valuation data itself is loading
  if (isLoading || !valuation)
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-7 w-24" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Separator className="mb-4" />
          <div className="space-y-4 text-sm">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>

          <PerformanceGrid isLoading={true} />
        </CardContent>
        <CardFooter className="flex justify-end px-3 pb-0">
          <Skeleton className="h-3 w-48" />
        </CardFooter>
      </Card>
    );

  const displayCurrency = valuation?.accountCurrency || valuation?.baseCurrency;
  const performanceCurrency = performance?.scope.currency || displayCurrency;
  const performancePnl = performancePeriodPnl(performance);
  const performanceReturn = performanceSummaryReturn(performance);
  const allTimeReturnAmount = valuation.totalValue - valuation.netContribution;
  const allTimeReturnValue = (
    <GainAmount value={allTimeReturnAmount} currency={displayCurrency} className="text-sm" />
  );
  const unrealizedPnl = valuation.investmentMarketValue - valuation.costBasis;
  const canShowUnrealizedPnl = valuation.basisStatus === "complete";
  const unrealizedPnlValue = canShowUnrealizedPnl ? (
    <GainAmount value={unrealizedPnl} currency={displayCurrency} className="text-sm" />
  ) : (
    <span className="text-muted-foreground text-xs">N/A</span>
  );

  // Book value includes position cost basis plus cash.
  const holdingsBookValue = valuation?.bookBasis ?? valuation?.costBasis ?? 0;

  // Different rows for Holdings vs Transactions mode
  const rows = isHoldingsMode
    ? [
        {
          label: "Investments",
          value: (
            <PrivacyAmount
              value={valuation?.investmentMarketValue || 0}
              currency={displayCurrency}
            />
          ),
        },
        {
          label: "Book Value",
          value: <PrivacyAmount value={holdingsBookValue} currency={displayCurrency} />,
        },
        {
          label: "Period P&L",
          value:
            performancePnl == null ? (
              <span className="text-muted-foreground text-xs">N/A</span>
            ) : (
              <span className="flex items-center gap-1">
                <GainAmount
                  value={performancePnl}
                  currency={performanceCurrency}
                  className="text-sm"
                />
                {performanceReturn == null ? (
                  <span className="text-muted-foreground text-xs">N/A</span>
                ) : (
                  <GainPercent value={performanceReturn} variant="badge" className="text-xs" />
                )}
              </span>
            ),
        },
      ]
    : [
        {
          label: "Investments",
          value: (
            <PrivacyAmount
              value={valuation?.investmentMarketValue || 0}
              currency={displayCurrency}
            />
          ),
        },
        {
          label: "Net Contribution",
          value: (
            <PrivacyAmount value={valuation?.netContribution || 0} currency={displayCurrency} />
          ),
        },
        {
          label: "Cost Basis",
          value: <PrivacyAmount value={valuation?.costBasis || 0} currency={displayCurrency} />,
        },
        {
          label: "All-time Return",
          value: allTimeReturnValue,
        },
        {
          label: "Unrealized P&L",
          value: unrealizedPnlValue,
        },
      ];

  const formattedStartDate = performance ? formatDate(performance.period.startDate || "") : "";
  const formattedEndDate = performance ? formatDate(performance.period.endDate || "") : "";
  const hasPerformancePeriod = Boolean(formattedStartDate && formattedEndDate);
  const lastUpdated = valuation?.calculatedAt ? formatDate(valuation.calculatedAt) : null;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-bold">{balanceLabel}</CardTitle>
        <div className="flex items-center gap-2">
          {balanceWarning ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="bg-warning/10 text-warning hover:bg-warning/15 size-8 rounded-full"
                    onClick={balanceWarning.onClick}
                    disabled={balanceWarning.disabled || balanceWarning.isLoading}
                    aria-label={balanceWarning.label}
                  >
                    {balanceWarning.isLoading ? (
                      <Icons.Spinner className="size-4 animate-spin" />
                    ) : (
                      <Icons.AlertCircle className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{balanceWarning.label}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {valuation && !hideBalanceEdit ? (
            <EditableBalance
              account={valuation}
              initialBalance={valuation?.cashBalance || 0}
              currency={displayCurrency}
            />
          ) : (
            <span className="text-lg font-extrabold">
              <PrivacyAmount value={valuation?.cashBalance || 0} currency={displayCurrency} />
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pb-2">
        <CashCurrencyBreakdown
          cashCurrencySplit={cashCurrencySplit}
          displayCurrency={displayCurrency}
        />
        <Separator />
        <div className="space-y-2.5 text-sm">
          {rows.map(({ label, value }, idx) => (
            <div key={idx} className="flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className={`font-medium`}>{value}</span>
            </div>
          ))}
        </div>

        <PerformanceGrid
          performance={performance}
          isLoading={isPerformanceLoading}
          performanceError={performanceError}
          isHoldingsMode={isHoldingsMode}
        />
      </CardContent>
      <CardFooter className="mt-auto flex flex-col items-start gap-1 px-3 pb-3 pt-0">
        {performanceError ? (
          <p className="text-muted-foreground m-0 p-0 text-xs">
            {lastUpdated && <>Last updated: {lastUpdated}</>}
          </p>
        ) : isHoldingsMode ? (
          <>
            <p className="text-muted-foreground m-0 p-0 text-xs">
              TWR and IRR require transaction tracking.
            </p>
            {lastUpdated && (
              <p className="text-muted-foreground m-0 p-0 text-xs">Last updated: {lastUpdated}</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground m-0 p-0 text-xs">
            {hasPerformancePeriod
              ? `From ${formattedStartDate} to ${formattedEndDate}`
              : lastUpdated
                ? `Last updated: ${lastUpdated}`
                : ""}
          </p>
        )}
      </CardFooter>
    </Card>
  );
};

export default AccountMetrics;
