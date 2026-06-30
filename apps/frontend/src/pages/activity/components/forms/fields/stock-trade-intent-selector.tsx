import { useController, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { AnimatedToggleGroup } from "@wealthfolio/ui";
import { ACTIVITY_SUBTYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";

type StockTradeSide = "buy" | "sell";

// Sentinel for the "normal" (no subtype) option — AnimatedToggleGroup needs string values.
const NORMAL = "NORMAL";

interface StockTradeIntentSelectorProps<TFieldValues extends FieldValues = FieldValues> {
  control: Control<TFieldValues>;
  name?: FieldPath<TFieldValues>;
  side: StockTradeSide;
  className?: string;
  /** Hide the "Trade Type" label and render a compact toggle (for card headers) */
  hideLabel?: boolean;
}

export function StockTradeIntentSelector<TFieldValues extends FieldValues = FieldValues>({
  control,
  name = "subtype" as FieldPath<TFieldValues>,
  side,
  className,
  hideLabel = false,
}: StockTradeIntentSelectorProps<TFieldValues>) {
  const { field } = useController({
    name,
    control,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultValue: null as any,
  });

  const shortValue =
    side === "sell" ? ACTIVITY_SUBTYPES.POSITION_OPEN : ACTIVITY_SUBTYPES.POSITION_CLOSE;
  const items =
    side === "sell"
      ? [
          { value: NORMAL, label: "Sell" },
          { value: shortValue, label: "Sell Short" },
        ]
      : [
          { value: NORMAL, label: "Buy" },
          { value: shortValue, label: "Buy to Cover" },
        ];

  const selectedValue = field.value === shortValue ? shortValue : NORMAL;

  if (hideLabel) {
    return (
      <div role="group" aria-label="Trade Type" className={className}>
        <AnimatedToggleGroup
          value={selectedValue}
          onValueChange={(value) => field.onChange(value === NORMAL ? null : value)}
          items={items}
          size="sm"
          rounded="lg"
          className="h-9"
        />
      </div>
    );
  }

  return (
    <div role="group" aria-label="Trade Type" className={cn("space-y-2", className)}>
      <span className="text-sm font-medium">Trade Type</span>
      <AnimatedToggleGroup
        value={selectedValue}
        onValueChange={(value) => field.onChange(value === NORMAL ? null : value)}
        items={items}
        rounded="lg"
        className="grid h-10 w-full grid-cols-2"
      />
    </div>
  );
}
