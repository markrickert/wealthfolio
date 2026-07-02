import { Icons } from "@wealthfolio/ui/components/ui/icons";
import React from "react";

const addonIconMap = {
  addon: Icons.Addons,
  addons: Icons.Addons,
  blocks: Icons.Blocks,
  chart: Icons.Insight,
  dashboard: Icons.Dashboard,
  goal: Icons.Goal,
  goals: Icons.Goals,
  holdings: Icons.Holdings,
  settings: Icons.Settings,
  wallet: Icons.Wallet,
} satisfies Record<string, React.ComponentType<{ className?: string }>>;

export function resolveNavigationIcon(icon: React.ReactNode, className: string) {
  if (!icon) {
    return <Icons.ArrowRight className={className} />;
  }

  if (typeof icon === "string") {
    const IconComponent = addonIconMap[icon.toLowerCase() as keyof typeof addonIconMap];
    return IconComponent ? (
      <IconComponent className={className} />
    ) : (
      <Icons.Addons className={className} />
    );
  }

  if (React.isValidElement<{ className?: string }>(icon)) {
    return icon.props.className ? icon : React.cloneElement(icon, { className });
  }

  if (typeof icon === "function") {
    const IconComponent = icon as React.ComponentType<{ className?: string }>;
    return <IconComponent className={className} />;
  }

  return <Icons.ArrowRight className={className} />;
}
