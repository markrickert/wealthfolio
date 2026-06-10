import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui/components/ui/card";
import { Separator } from "@wealthfolio/ui/components/ui/separator";
import { formatPercent } from "@wealthfolio/ui";
import { GainPercent } from "@wealthfolio/ui";
import { AmountDisplay } from "@wealthfolio/ui";
import { QuantityDisplay } from "@wealthfolio/ui";
import { useBalancePrivacy } from "@/hooks/use-balance-privacy";

interface AssetDetail {
  numShares: number;
  marketValue: number;
  costBasis: number;
  averagePrice: number;
  portfolioPercent: number;
  todaysReturn: number | null;
  todaysReturnPercent: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  realizedPnl: number | null;
  realizedPnlPercent: number | null;
  income: number | null;
  fxEffect: number | null;
  priceReturnPercent: number | null;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  totalReturn: number | null;
  totalReturnPercent: number | null;
  currency: string;
  baseCurrency: string;
  quoteCurrency?: string | null;
  quote?: {
    open: number;
    high: number;
    low: number;
    volume: number;
    close: number;
    adjclose: number;
  } | null;
  bondSpec?: {
    maturityDate?: string | null;
    couponRate?: number | null;
    couponFrequency?: string | null;
  } | null;
  optionSpec?: {
    right?: string | null;
    strike?: number | null;
    expiration?: string | null;
  } | null;
  className?: string;
}

interface AssetDetailProps {
  assetData: AssetDetail;
  className?: string;
}

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
    {children}
  </div>
);

const AssetDetailCard: React.FC<AssetDetailProps> = ({ assetData, className }) => {
  const { isBalanceHidden } = useBalancePrivacy();

  const {
    numShares,
    marketValue,
    costBasis,
    averagePrice,
    portfolioPercent,
    todaysReturn,
    todaysReturnPercent,
    unrealizedPnl,
    unrealizedPnlPercent,
    realizedPnl,
    realizedPnlPercent,
    income,
    fxEffect,
    priceReturnPercent,
    totalPnl,
    totalPnlPercent,
    totalReturn,
    totalReturnPercent,
    currency,
    baseCurrency,
    quoteCurrency,
    quote,
    bondSpec,
    optionSpec,
  } = assetData;

  const isOption = optionSpec != null;
  const quantityLabel = isOption ? "contracts" : "shares";
  const averageCostLabel = isOption ? "Average premium" : "Average cost";

  const amountTone = (amount: number | null) => {
    if (amount == null || amount === 0) return "";
    return amount < 0 ? "text-destructive" : "text-success";
  };

  const positionRows = [
    {
      label: "Book value",
      value: <AmountDisplay value={costBasis} currency={currency} isHidden={isBalanceHidden} />,
    },
    {
      label: averageCostLabel,
      value: <AmountDisplay value={averagePrice} currency={currency} isHidden={isBalanceHidden} />,
    },
    { label: "% of my portfolio", value: formatPercent(portfolioPercent) },
  ];

  const performanceRows: {
    label: string;
    amount: number | null;
    currency: string;
    percent: number | null;
    color: string;
  }[] = [
    ...(todaysReturn !== null && todaysReturnPercent !== null
      ? [
          {
            label: "Today's return",
            amount: todaysReturn,
            currency,
            percent: todaysReturnPercent,
            color: amountTone(todaysReturn),
          },
        ]
      : []),
    {
      label: "Unrealized P&L",
      amount: unrealizedPnl,
      currency,
      percent: unrealizedPnlPercent,
      color: amountTone(unrealizedPnl),
    },
    {
      label: "Realized P&L",
      amount: realizedPnl,
      currency,
      percent: realizedPnlPercent,
      color: amountTone(realizedPnl),
    },
    {
      label: "Income",
      amount: income,
      currency,
      percent: null,
      color: amountTone(income),
    },
    {
      label: "FX effect",
      amount: fxEffect,
      currency: baseCurrency,
      percent: null,
      color: amountTone(fxEffect),
    },
    {
      label: "Price return",
      amount: null,
      currency,
      percent: priceReturnPercent,
      color: amountTone(priceReturnPercent),
    },
    {
      label: "Total P&L",
      amount: totalPnl,
      currency,
      percent: totalPnlPercent,
      color: amountTone(totalPnl),
    },
    {
      label: "Total Return",
      amount: totalReturn,
      currency,
      percent: totalReturnPercent,
      color: amountTone(totalReturn),
    },
  ];

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-0">
        <CardTitle className="flex w-full justify-between text-lg font-bold">
          <div>
            <div>
              <QuantityDisplay value={numShares} isHidden={isBalanceHidden} />
            </div>
            <div className="text-muted-foreground text-sm font-normal">{quantityLabel}</div>
          </div>
          <div>
            <div className="text-xl font-extrabold">
              <AmountDisplay value={marketValue} currency={currency} isHidden={isBalanceHidden} />
            </div>
            <div className="text-muted-foreground text-right text-sm font-normal">{currency}</div>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <Separator className="my-3" />
        <div>
          <SectionHeader>Position</SectionHeader>
          <div className="space-y-1.5 text-sm">
            {positionRows.map(({ label, value }, idx) => (
              <div key={idx} className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <Separator className="my-3" />
        <div>
          <SectionHeader>Performance</SectionHeader>
          <div className="space-y-1.5 text-sm">
            {performanceRows.map(
              ({ label, amount, currency: rowCurrency, percent, color }, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="flex items-center gap-2">
                    {amount == null && percent == null ? (
                      <span className="text-muted-foreground">N/A</span>
                    ) : (
                      <>
                        {amount != null && (
                          <span className={`font-medium ${color || ""}`}>
                            <AmountDisplay
                              value={amount}
                              currency={rowCurrency}
                              isHidden={isBalanceHidden}
                            />
                          </span>
                        )}
                        {percent != null && (
                          <GainPercent variant="badge" value={percent} className="text-xs" />
                        )}
                      </>
                    )}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>

        {quote && (
          <>
            <Separator className="my-3" />
            <div>
              <SectionHeader>Day Range</SectionHeader>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Open</span>
                  <div className="text-sm font-medium">
                    <AmountDisplay
                      value={quote.open}
                      currency={quoteCurrency ?? currency}
                      isHidden={isBalanceHidden}
                    />
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-muted-foreground text-xs">Close</span>
                  <div className="text-sm font-medium">
                    <AmountDisplay
                      value={quote.close}
                      currency={quoteCurrency ?? currency}
                      isHidden={isBalanceHidden}
                    />
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">High</span>
                  <div className="text-success text-sm font-medium">
                    <AmountDisplay
                      value={quote.high}
                      currency={quoteCurrency ?? currency}
                      isHidden={isBalanceHidden}
                    />
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-muted-foreground text-xs">Low</span>
                  <div className="text-destructive text-sm font-medium">
                    <AmountDisplay
                      value={quote.low}
                      currency={quoteCurrency ?? currency}
                      isHidden={isBalanceHidden}
                    />
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Adj Close</span>
                  <div className="text-sm font-medium">
                    <AmountDisplay
                      value={quote.adjclose}
                      currency={quoteCurrency ?? currency}
                      isHidden={isBalanceHidden}
                    />
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-muted-foreground text-xs">Volume</span>
                  <span className="text-sm font-medium">
                    {new Intl.NumberFormat().format(quote.volume)}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {bondSpec && (
          <>
            <Separator className="my-3" />
            <div className="grid grid-cols-2 gap-x-6">
              {bondSpec.couponRate != null && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Coupon</span>
                  <span className="text-sm font-medium">
                    {bondSpec.couponFrequency === "ZERO"
                      ? "Zero coupon"
                      : `${(bondSpec.couponRate * 100).toFixed(3)}%`}
                    {bondSpec.couponFrequency &&
                      bondSpec.couponFrequency !== "ZERO" &&
                      ` ${bondSpec.couponFrequency.replace("_", " ").toLowerCase()}`}
                  </span>
                </div>
              )}
              {bondSpec.maturityDate && (
                <div className="flex flex-col items-end">
                  <span className="text-muted-foreground text-xs">Maturity</span>
                  <span className="text-sm font-medium">
                    {new Date(bondSpec.maturityDate + "T00:00:00").toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {optionSpec && (
          <>
            <Separator className="my-3" />
            <div className="grid grid-cols-3 gap-x-4">
              {optionSpec.right && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Type</span>
                  <span className="text-sm font-medium">{optionSpec.right}</span>
                </div>
              )}
              {optionSpec.strike != null && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Strike</span>
                  <div className="text-sm font-medium">
                    <AmountDisplay
                      value={optionSpec.strike}
                      currency={quoteCurrency ?? currency}
                      isHidden={isBalanceHidden}
                    />
                  </div>
                </div>
              )}
              {optionSpec.expiration && (
                <div className="flex flex-col items-end">
                  <span className="text-muted-foreground text-xs">Expiry</span>
                  <span className="text-sm font-medium">
                    {new Date(optionSpec.expiration + "T00:00:00").toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AssetDetailCard;
