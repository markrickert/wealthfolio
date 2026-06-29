import { useEffect, useMemo, useRef } from "react";
import { useHoldings } from "@/hooks/use-holdings";
import { useSettings } from "@/hooks/use-settings";
import { ACTIVITY_SUBTYPES, ActivityType, QuoteMode } from "@/lib/constants";
import { buildOccSymbol } from "@/lib/occ-symbol";
import { normalizeCurrency } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription } from "@wealthfolio/ui/components/ui/alert";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Card, CardContent } from "@wealthfolio/ui/components/ui/card";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { FormProvider, useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import {
  AccountSelect,
  AdvancedOptionsSection,
  AmountInput,
  AssetTypeSelector,
  createValidatedSubmit,
  DatePicker,
  NotesInput,
  OptionContractFields,
  PositionIntentSelector,
  QuantityInput,
  StockTradeIntentSelector,
  SymbolSearch,
  type AssetType,
  type AccountSelectOption,
} from "./fields";

// Asset metadata schema for custom assets
const assetMetadataSchema = z
  .object({
    name: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    exchangeMic: z.string().nullable().optional(),
    providerId: z.string().nullable().optional(),
    providerSymbol: z.string().nullable().optional(),
  })
  .optional();

// Zod schema for BuyForm validation
export const buyFormSchema = z
  .object({
    assetType: z.enum(["stock", "option", "bond"]).default("stock"),
    assetKind: z.string().optional(),
    accountId: z.string().min(1, { message: "Please select an account." }),
    assetId: z.string().default(""),
    existingAssetId: z.string().nullable().optional(),
    activityDate: z.date({ required_error: "Please select a date." }),
    quantity: z.coerce
      .number({
        required_error: "Please enter a quantity.",
        invalid_type_error: "Quantity must be a number.",
      })
      .positive({ message: "Quantity must be greater than 0." }),
    unitPrice: z.coerce
      .number({
        required_error: "Please enter a price.",
        invalid_type_error: "Price must be a number.",
      })
      .positive({ message: "Price must be greater than 0." }),
    fee: z.coerce
      .number({
        invalid_type_error: "Fee must be a number.",
      })
      .min(0, { message: "Fee must be non-negative." })
      .default(0),
    comment: z.string().optional().nullable(),
    subtype: z.string().optional().nullable(),
    // Advanced options
    currency: z.string().min(1, { message: "Currency is required." }),
    fxRate: z.coerce
      .number({
        invalid_type_error: "FX Rate must be a number.",
      })
      .positive({ message: "FX Rate must be positive." })
      .optional(),
    // Internal fields
    quoteMode: z.enum([QuoteMode.MARKET, QuoteMode.MANUAL]).default(QuoteMode.MARKET),
    exchangeMic: z.string().nullable().optional(),
    symbolQuoteCcy: z.string().nullable().optional(),
    symbolInstrumentType: z.string().nullable().optional(),
    // Asset metadata for custom assets (name, etc.)
    assetMetadata: assetMetadataSchema,
    // Option-specific fields
    underlyingSymbol: z.string().optional(),
    strikePrice: z.coerce.number().positive().optional(),
    expirationDate: z.string().optional(),
    optionType: z.enum(["CALL", "PUT"]).optional(),
    contractMultiplier: z.coerce.number().positive().default(100).optional(),
  })
  .superRefine((data, ctx) => {
    // Options build their symbol at submit time; stocks/bonds require it upfront
    if (data.assetType !== "option" && (!data.assetId || data.assetId.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please enter a symbol.",
        path: ["assetId"],
      });
    }
    // Option contracts require all 4 structured fields
    if (data.assetType === "option") {
      // Require an explicit Open/Close choice — never silently default the intent.
      if (
        data.subtype !== ACTIVITY_SUBTYPES.POSITION_OPEN &&
        data.subtype !== ACTIVITY_SUBTYPES.POSITION_CLOSE
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select whether this opens or closes a position.",
          path: ["subtype"],
        });
      }
      if (!data.underlyingSymbol?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Underlying symbol is required.",
          path: ["underlyingSymbol"],
        });
      }
      if (!data.strikePrice || data.strikePrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Strike price is required.",
          path: ["strikePrice"],
        });
      }
      if (!data.expirationDate?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expiration date is required.",
          path: ["expirationDate"],
        });
      }
      if (!data.optionType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Option type is required.",
          path: ["optionType"],
        });
      }
    }
  });

export type BuyFormValues = z.infer<typeof buyFormSchema>;

interface BuyFormProps {
  accounts: AccountSelectOption[];
  defaultValues?: Partial<BuyFormValues>;
  onSubmit: (data: BuyFormValues) => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  isEditing?: boolean;
  /** Asset currency (from selected symbol) for advanced options */
  assetCurrency?: string;
}

export function BuyForm({
  accounts,
  defaultValues,
  onSubmit,
  onCancel,
  isLoading = false,
  isEditing = false,
  assetCurrency,
}: BuyFormProps) {
  const { data: settings } = useSettings();
  const baseCurrency = settings?.baseCurrency;

  // Compute initial account and currency for defaultValues
  const initialAccountId =
    defaultValues?.accountId ?? (accounts.length === 1 ? accounts[0].value : "");
  const initialAccount = accounts.find((a) => a.value === initialAccountId);
  // Currency priority: provided default > normalized asset currency > account currency
  const initialCurrency =
    defaultValues?.currency?.trim() || assetCurrency?.trim() || initialAccount?.currency;

  const form = useForm<BuyFormValues>({
    resolver: zodResolver(buyFormSchema) as Resolver<BuyFormValues>,
    mode: "onSubmit",
    defaultValues: {
      assetType: "stock",
      assetKind: undefined,
      accountId: initialAccountId,
      assetId: "",
      activityDate: (() => {
        const date = new Date();
        date.setHours(16, 0, 0, 0);
        return date;
      })(),
      quantity: undefined,
      unitPrice: undefined,
      fee: 0,
      comment: null,
      subtype: null,
      fxRate: undefined,
      quoteMode: QuoteMode.MARKET,
      exchangeMic: undefined,
      // Option defaults
      underlyingSymbol: undefined,
      strikePrice: undefined,
      expirationDate: undefined,
      optionType: "CALL",
      contractMultiplier: 100,
      ...defaultValues,
      currency: defaultValues?.currency?.trim() || initialCurrency,
    },
  });

  const { watch, setValue } = form;
  const accountId = watch("accountId");
  const assetId = watch("assetId");
  const currency = watch("currency");
  const quoteMode = watch("quoteMode");
  const symbolQuoteCcy = watch("symbolQuoteCcy");

  // Set currency from account when account changes and currency is not yet set
  useEffect(() => {
    if (!currency && accountId) {
      const acct = accounts.find((a) => a.value === accountId);
      if (acct?.currency) setValue("currency", acct.currency);
    }
  }, [accountId, currency, accounts, setValue]);
  const assetType = watch("assetType") ?? "stock";
  const isManualAsset = quoteMode === QuoteMode.MANUAL;
  const isOption = assetType === "option";
  const isStock = assetType === "stock";
  const subtype = watch("subtype");

  // Reset the stock "Buy to Cover" intent when the selected symbol changes — a
  // cover intent for one symbol must not silently carry over to another.
  // SymbolSearch owns the assetId field and exposes no onChange, so we track the
  // previous value to fire only on an actual symbol switch (not on mount/edit).
  const prevAssetIdRef = useRef(assetId);
  useEffect(() => {
    if (prevAssetIdRef.current !== assetId) {
      if (isStock && subtype === ACTIVITY_SUBTYPES.POSITION_CLOSE) {
        setValue("subtype", null);
      }
      prevAssetIdRef.current = assetId;
    }
  }, [assetId, isStock, subtype, setValue]);
  const optionSubmitLabel =
    subtype === ACTIVITY_SUBTYPES.POSITION_CLOSE
      ? "Buy to Close"
      : subtype === ACTIVITY_SUBTYPES.POSITION_OPEN
        ? "Buy to Open"
        : "Add Buy";
  const isStockCover = isStock && subtype === ACTIVITY_SUBTYPES.POSITION_CLOSE;
  const buySubmitLabel = isStockCover ? "Buy to Cover" : "Add Buy";

  // Option total premium calculation
  const optQuantity = watch("quantity");
  const optUnitPrice = watch("unitPrice");
  const optFee = watch("fee");
  const optMultiplier = watch("contractMultiplier");

  const optionTotal = useMemo(() => {
    if (!isOption) return 0;
    const q = Number(optQuantity) || 0;
    const p = Number(optUnitPrice) || 0;
    const f = Number(optFee) || 0;
    const m = Number(optMultiplier) || 100;
    return q * p * m + f;
  }, [isOption, optQuantity, optUnitPrice, optFee, optMultiplier]);

  const handleAssetTypeChange = (value: AssetType) => {
    if (value === "option") {
      setValue("quoteMode", QuoteMode.MARKET);
      setValue("assetKind", "OPTION");
      // No default position intent — the user must explicitly pick Open or Close.
      setValue("subtype", null);
    } else if (value === "bond") {
      setValue("quoteMode", QuoteMode.MARKET);
      setValue("assetKind", "BOND");
      setValue("subtype", null);
    } else {
      setValue("quoteMode", QuoteMode.MARKET);
      setValue("assetKind", undefined);
      setValue("subtype", null);
    }
    setValue("assetId", "");
    setValue("existingAssetId", undefined);
    setValue("exchangeMic", undefined);
    setValue("symbolQuoteCcy", undefined);
    setValue("symbolInstrumentType", undefined);
    setValue("assetMetadata", undefined);
  };

  const quantityLabel = isOption ? "Contracts" : assetType === "bond" ? "Bonds" : "Quantity";
  const priceLabel = isOption ? "Premium/Share" : "Price";
  // Get account currency from selected account
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.value === accountId),
    [accounts, accountId],
  );
  const accountCurrency = selectedAccount?.currency;
  const assetCurrencyFromSymbol = normalizeCurrency(symbolQuoteCcy ?? undefined)?.toUpperCase();

  const { holdings } = useHoldings({ type: "account", accountId });
  const currentHoldingQuantity = useMemo(() => {
    if (!assetId || !holdings) return 0;
    const holding = holdings.find(
      (h) => h.instrument?.symbol === assetId || h.instrument?.id === assetId || h.id === assetId,
    );
    return holding?.quantity ?? 0;
  }, [assetId, holdings]);
  const currentShortQuantity = currentHoldingQuantity < 0 ? Math.abs(currentHoldingQuantity) : 0;
  const isEditingCoverActivity =
    isEditing &&
    (defaultValues?.assetType ?? "stock") === "stock" &&
    defaultValues?.subtype === ACTIVITY_SUBTYPES.POSITION_CLOSE;
  const showBuyToCover =
    isStock && (currentShortQuantity > 0 || isStockCover || isEditingCoverActivity);
  const isCoverWithoutShort = !isEditing && isStockCover && !!assetId && currentShortQuantity === 0;
  const isBuyWhileShortWithoutCover =
    !isEditing && isStock && !!assetId && currentShortQuantity > 0 && !isStockCover;
  const isCoverQuantityExcess =
    !isEditing &&
    isStockCover &&
    !!assetId &&
    currentShortQuantity > 0 &&
    Number(optQuantity) > currentShortQuantity;

  const handleSubmit = createValidatedSubmit(form, async (data) => {
    // Ensure currency is set (required by backend) — fall back to account currency
    if (!data.currency && accountId) {
      data.currency = accounts.find((a) => a.value === accountId)?.currency ?? data.currency;
    }
    // Ensure symbolQuoteCcy is set — manual/custom symbols leave it undefined
    if (!data.symbolQuoteCcy && data.currency) {
      data.symbolQuoteCcy = data.currency;
    }
    // Stocks only use subtype for explicit Buy to Cover.
    if (data.assetType === "stock" && data.subtype !== ACTIVITY_SUBTYPES.POSITION_CLOSE) {
      data.subtype = null;
    }
    // For options: build OCC symbol from structured fields
    if (
      data.assetType === "option" &&
      data.underlyingSymbol &&
      data.strikePrice &&
      data.expirationDate &&
      data.optionType
    ) {
      const occSymbol = buildOccSymbol(
        data.underlyingSymbol,
        data.expirationDate,
        data.optionType,
        data.strikePrice,
      );
      data.assetId = occSymbol;
      data.existingAssetId = undefined;
      data.symbolInstrumentType = "OPTION";
      // subtype is required for options by the schema — no silent default here.
      data.assetMetadata = {
        ...data.assetMetadata,
        name: `${data.underlyingSymbol.toUpperCase()} ${data.expirationDate} ${data.optionType} ${data.strikePrice}`,
        kind: "OPTION",
      };
    }
    // For bonds: set instrument type
    if (data.assetType === "bond") {
      data.symbolInstrumentType = data.symbolInstrumentType ?? "BOND";
    }
    await onSubmit(data);
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardContent className="space-y-6 pt-4">
            {/* Asset Type Selector */}
            {!isEditing && (
              <AssetTypeSelector
                control={form.control}
                name="assetType"
                onValueChange={handleAssetTypeChange}
              />
            )}

            {/* Account Selection */}
            <AccountSelect name="accountId" accounts={accounts} currencyName="currency" />

            {/* Date Picker */}
            <DatePicker name="activityDate" label="Date" enableTime={true} />

            {/* Symbol / Option Contract Fields */}
            {isOption ? (
              <OptionContractFields
                underlyingName="underlyingSymbol"
                strikePriceName="strikePrice"
                expirationDateName="expirationDate"
                optionTypeName="optionType"
                currencyName="currency"
                exchangeMicName="exchangeMic"
                quoteCcyName="symbolQuoteCcy"
                unitPriceName="unitPrice"
              />
            ) : (
              <>
                <SymbolSearch
                  name="assetId"
                  isManualAsset={isManualAsset}
                  exchangeMicName="exchangeMic"
                  quoteModeName="quoteMode"
                  currencyName="currency"
                  quoteCcyName="symbolQuoteCcy"
                  instrumentTypeName="symbolInstrumentType"
                  existingAssetIdName="existingAssetId"
                  assetMetadataName="assetMetadata"
                />
                {/* Hidden fields to register assetMetadata for react-hook-form */}
                <input type="hidden" {...form.register("assetMetadata.name")} />
                <input type="hidden" {...form.register("assetMetadata.kind")} />
                <input type="hidden" {...form.register("symbolQuoteCcy")} />
                <input type="hidden" {...form.register("symbolInstrumentType")} />
                <input type="hidden" {...form.register("existingAssetId")} />
              </>
            )}

            {/* Quantity, Price, Fee Row */}
            {isOption ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-muted-foreground text-sm font-medium">Trade Details</h4>
                <PositionIntentSelector control={form.control} name="subtype" />
              </div>
            ) : showBuyToCover ? (
              <div className="space-y-3">
                <h4 className="text-muted-foreground text-sm font-medium">Trade Details</h4>
                <StockTradeIntentSelector control={form.control} name="subtype" side="buy" />
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <QuantityInput name="quantity" label={quantityLabel} />
                {/* Shares breakdown with click-to-edit multiplier */}
                {isOption && optQuantity && (
                  <div className="text-muted-foreground mt-1.5 flex items-center gap-1 text-xs">
                    <span>{Number(optQuantity) * (Number(optMultiplier) || 100)} shares</span>
                    <span>·</span>
                    <input
                      type="number"
                      {...form.register("contractMultiplier", { valueAsNumber: true })}
                      className="hover:border-input focus:border-input focus:bg-background focus:ring-ring h-5 w-14 rounded border border-transparent bg-transparent px-1 text-center text-xs tabular-nums focus:outline-none focus:ring-1"
                      aria-label="Contract Multiplier"
                    />
                    <span>x</span>
                  </div>
                )}
                {isStock && currentShortQuantity > 0 && (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    Short: {currentShortQuantity.toLocaleString()} shares
                  </p>
                )}
              </div>
              <AmountInput
                name="unitPrice"
                label={priceLabel}
                maxDecimalPlaces={4}
                currency={currency}
              />
              <AmountInput name="fee" label="Fee" currency={currency} />
            </div>

            {/* Option Total Premium with formula breakdown */}
            {isOption && optQuantity && optUnitPrice && (
              <div className="bg-muted/50 border-border rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-muted-foreground text-xs font-medium uppercase">
                      Total Debit
                    </span>
                    <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      {Number(optQuantity)} ×{" "}
                      {currency
                        ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
                            Number(optUnitPrice),
                          )
                        : Number(optUnitPrice)}{" "}
                      × {Number(optMultiplier) || 100}
                      {Number(optFee) > 0 && (
                        <>
                          {" "}
                          +{" "}
                          {currency
                            ? new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency,
                              }).format(Number(optFee))
                            : Number(optFee)}
                        </>
                      )}
                    </p>
                  </div>
                  <span className="text-lg font-semibold tabular-nums">
                    {new Intl.NumberFormat("en-US", {
                      style: currency ? "currency" : "decimal",
                      currency: currency || undefined,
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }).format(optionTotal)}
                  </span>
                </div>
              </div>
            )}

            {isBuyWhileShortWithoutCover && (
              <Alert variant="default" className="border-warning bg-warning/10">
                <Icons.AlertTriangle className="text-warning h-4 w-4" />
                <AlertDescription className="text-warning text-sm">
                  You currently have a short position in this stock. Use Buy to Cover to reduce it;
                  enter a normal Buy only after the short position is closed.
                </AlertDescription>
              </Alert>
            )}

            {isCoverWithoutShort && (
              <Alert variant="default" className="border-warning bg-warning/10">
                <Icons.AlertTriangle className="text-warning h-4 w-4" />
                <AlertDescription className="text-warning text-sm">
                  Buy to Cover requires an existing short position for this stock in the selected
                  account.
                </AlertDescription>
              </Alert>
            )}

            {isCoverQuantityExcess && (
              <Alert variant="default" className="border-warning bg-warning/10">
                <Icons.AlertTriangle className="text-warning h-4 w-4" />
                <AlertDescription className="text-warning text-sm">
                  You are covering {Number(optQuantity).toLocaleString()} shares, but the current
                  short position is {currentShortQuantity.toLocaleString()} shares. Enter any excess
                  as a separate Buy activity.
                </AlertDescription>
              </Alert>
            )}

            {/* Advanced Options */}
            <AdvancedOptionsSection
              currencyName="currency"
              fxRateName="fxRate"
              activityType={ActivityType.BUY}
              assetCurrency={assetCurrencyFromSymbol ?? normalizeCurrency(assetCurrency)}
              accountCurrency={accountCurrency}
              baseCurrency={baseCurrency}
            />

            {/* Notes */}
            <NotesInput name="comment" label="Notes" placeholder="Add an optional note..." />
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? (
              <Icons.Check className="mr-2 h-4 w-4" />
            ) : (
              <Icons.Plus className="mr-2 h-4 w-4" />
            )}
            {isEditing ? "Update" : isOption ? optionSubmitLabel : buySubmitLabel}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
