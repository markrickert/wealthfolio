import type { ActivityDetails, Asset, Quote } from "@/lib/types";
import { normalizeCurrency } from "@/lib/utils";
import { getQuoteUnitCurrency } from "@wealthfolio/ui/lib/currencies";

export function resolveBackendMarketQuoteFallback({
  asset,
  instrumentCurrency,
  baseCurrency,
}: {
  asset?: Asset | null;
  instrumentCurrency?: string | null;
  baseCurrency: string;
}) {
  return {
    marketPrice: asset?.displayMarketPrice != null ? Number(asset.displayMarketPrice) : 0,
    currency: asset?.displayMarketCurrency ?? instrumentCurrency ?? asset?.quoteCcy ?? baseCurrency,
  };
}

export function resolveQuoteDisplayFactor({
  quote,
  displayCurrency,
  marketPrice,
}: {
  quote?: Quote | null;
  displayCurrency: string;
  marketPrice: number;
}): number | null {
  if (!quote) return 1;

  const normalizedQuoteCurrency = normalizeCurrency(quote.currency)?.toUpperCase();
  const normalizedDisplayCurrency = normalizeCurrency(displayCurrency)?.toUpperCase();
  if (
    !normalizedQuoteCurrency ||
    !normalizedDisplayCurrency ||
    normalizedQuoteCurrency !== normalizedDisplayCurrency
  ) {
    return null;
  }

  const close = Number(quote.close);
  const price = Number(marketPrice);
  if (!Number.isFinite(close) || close === 0 || !Number.isFinite(price) || price === 0) {
    return 1;
  }

  return price / close;
}

export function normalizeQuoteForDisplay({
  quote,
  displayCurrency,
  quoteDisplayFactor,
}: {
  quote: Quote;
  displayCurrency: string;
  quoteDisplayFactor: number | null;
}): Quote {
  const normalizedQuoteCurrency = normalizeCurrency(quote.currency)?.toUpperCase();
  const normalizedDisplayCurrency = normalizeCurrency(displayCurrency)?.toUpperCase();
  if (
    quoteDisplayFactor == null ||
    !Number.isFinite(quoteDisplayFactor) ||
    normalizedQuoteCurrency !== normalizedDisplayCurrency
  ) {
    return quote;
  }

  return {
    ...quote,
    open: quote.open * quoteDisplayFactor,
    high: quote.high * quoteDisplayFactor,
    low: quote.low * quoteDisplayFactor,
    close: quote.close * quoteDisplayFactor,
    adjclose: quote.adjclose * quoteDisplayFactor,
    currency: displayCurrency,
  };
}

export function normalizeQuoteHistoryForDisplay({
  quoteHistory,
  displayCurrency,
  quoteDisplayFactor,
}: {
  quoteHistory: Quote[];
  displayCurrency: string;
  quoteDisplayFactor: number | null;
}) {
  return quoteHistory.map((quote) =>
    normalizeQuoteForDisplay({ quote, displayCurrency, quoteDisplayFactor }),
  );
}

export function sumDisplayIncomeActivities({
  activities,
  displayCurrency,
  quoteDisplayFactor,
}: {
  activities: ActivityDetails[];
  displayCurrency: string;
  quoteDisplayFactor: number | null;
}): number | null {
  const normalizedDisplayCurrency = normalizeCurrency(displayCurrency)?.toUpperCase();
  if (!normalizedDisplayCurrency) return null;

  let sum = 0;
  for (const activity of activities) {
    const normalizedActivityCurrency = normalizeCurrency(activity.currency)?.toUpperCase();
    if (normalizedActivityCurrency !== normalizedDisplayCurrency) {
      return null;
    }

    const amount = Number(activity.amount ?? 0);
    if (!Number.isFinite(amount)) continue;

    const multiplier =
      !getQuoteUnitCurrency(activity.currency) &&
      activity.currency.trim().toUpperCase() === displayCurrency.trim().toUpperCase()
        ? 1
        : quoteDisplayFactor;
    if (multiplier == null || !Number.isFinite(multiplier)) {
      return null;
    }

    sum += amount * multiplier;
  }

  return sum;
}
