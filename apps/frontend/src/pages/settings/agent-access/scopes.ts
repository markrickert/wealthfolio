// Canonical agent-access token scopes shared by the web (server PAT) and
// desktop (Tauri) surfaces. The backend rejects unknown scopes, empty scope
// sets, and `activities:write` without `activities:draft`; this module keeps
// the UI in sync with that contract.

export type ScopeKey =
  | "accounts:read"
  | "holdings:read"
  | "performance:read"
  | "activities:read"
  | "financial-planning:read"
  | "health:read"
  | "classification:read"
  | "activities:draft"
  | "activities:write"
  | "classification:suggest";

export type ScopeGroup = "read" | "write";

export interface ScopeMeta {
  key: ScopeKey;
  label: string;
  description: string;
  group: ScopeGroup;
}

/** Ordered list of all 10 scopes, grouped reads first then write/suggest. */
export const SCOPES: ScopeMeta[] = [
  {
    key: "accounts:read",
    label: "Accounts (read)",
    description: "List accounts and their metadata.",
    group: "read",
  },
  {
    key: "holdings:read",
    label: "Holdings & value (read)",
    description: "Read holdings, positions, and portfolio value.",
    group: "read",
  },
  {
    key: "performance:read",
    label: "Performance (read)",
    description: "Read performance history and summaries.",
    group: "read",
  },
  {
    key: "activities:read",
    label: "Activities (read)",
    description: "Read transactions and other account activities.",
    group: "read",
  },
  {
    key: "financial-planning:read",
    label: "Financial planning (read)",
    description: "Read goals, contribution limits, and planning data.",
    group: "read",
  },
  {
    key: "health:read",
    label: "Health (read)",
    description: "Read portfolio health and diagnostic checks.",
    group: "read",
  },
  {
    key: "classification:read",
    label: "Classification (read)",
    description: "Read instrument classifications and taxonomies.",
    group: "read",
  },
  {
    key: "activities:draft",
    label: "Activities — draft",
    description: "Prepare draft activities for review (not committed).",
    group: "write",
  },
  {
    key: "activities:write",
    label: "Activities — commit/write",
    description: "Commit activities. Requires the draft scope.",
    group: "write",
  },
  {
    key: "classification:suggest",
    label: "Classification — suggest",
    description: "Suggest instrument classifications for review.",
    group: "write",
  },
];

/** The 7 read scopes, in canonical order. */
export const READ_SCOPES: ScopeKey[] = SCOPES.filter((scope) => scope.group === "read").map(
  (scope) => scope.key,
);

export interface ScopePreset {
  key: string;
  label: string;
  scopes: ScopeKey[];
}

/** Named presets. Order matters for "summarize to preset name" matching. */
export const SCOPE_PRESETS: ScopePreset[] = [
  {
    key: "read-only",
    label: "Read-only",
    scopes: [...READ_SCOPES],
  },
  {
    key: "read-activity-draft",
    label: "Read + draft",
    scopes: [...READ_SCOPES, "activities:draft"],
  },
  {
    key: "read-activity-write",
    label: "Read + write",
    scopes: [...READ_SCOPES, "activities:draft", "activities:write"],
  },
  {
    key: "read-activity-write-classification-suggest",
    label: "Read + write + suggest",
    scopes: [...READ_SCOPES, "activities:draft", "activities:write", "classification:suggest"],
  },
];

const SCOPE_LABELS = new Map(SCOPES.map((scope) => [scope.key, scope.label]));

/** Human label for a scope key; falls back to the raw key for unknown scopes. */
export function scopeLabel(key: string): string {
  return SCOPE_LABELS.get(key as ScopeKey) ?? key;
}

/**
 * Apply the dependency rule: selecting `activities:write` also selects
 * `activities:draft`. Returns scopes in canonical order with duplicates removed.
 */
export function applyScopeDependencies(scopes: Iterable<string>): ScopeKey[] {
  const set = new Set<string>(scopes);
  if (set.has("activities:write")) {
    set.add("activities:draft");
  }
  return SCOPES.filter((scope) => set.has(scope.key)).map((scope) => scope.key);
}

/** Returns the preset whose scope set exactly matches `scopes`, if any. */
export function matchPreset(scopes: string[]): ScopePreset | undefined {
  const target = new Set(scopes);
  return SCOPE_PRESETS.find(
    (preset) =>
      preset.scopes.length === target.size && preset.scopes.every((scope) => target.has(scope)),
  );
}
