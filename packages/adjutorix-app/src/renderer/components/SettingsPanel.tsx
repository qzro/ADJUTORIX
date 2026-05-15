import React, { useMemo, useState } from "react";

export type SettingsHealth = "healthy" | "degraded" | "unhealthy" | "unknown";
export type SettingScope = "user" | "workspace" | "session" | "system";
export type SettingRisk = "safe" | "guarded" | "destructive";
export type SettingKind = "boolean" | "enum" | "string" | "number" | "path";
export type SettingCategory =
  | "general"
  | "appearance"
  | "workspace"
  | "execution"
  | "patch-review"
  | "verify"
  | "providers"
  | "indexing"
  | "diagnostics"
  | "security";
export type SettingValidationSeverity = "info" | "warn" | "error";

export type SettingOption = {
  value: string;
  label: string;
  description?: string | null;
};

export type SettingValidationIssue = {
  id: string;
  severity: SettingValidationSeverity;
  message: string;
};

export type SettingItem = {
  id: string;
  key: string;
  title: string;
  description?: string | null;
  category: SettingCategory;
  scope: SettingScope;
  risk?: SettingRisk;
  kind: SettingKind;
  currentValue: string | number | boolean | null;
  effectiveValue?: string | number | boolean | null;
  defaultValue?: string | number | boolean | null;
  draftValue?: string | number | boolean | null;
  placeholder?: string | null;
  options?: SettingOption[];
  unitLabel?: string | null;
  mutable?: boolean;
  requiresRestart?: boolean;
  requiresReindex?: boolean;
  requiresReconnect?: boolean;
  lockedReason?: string | null;
  authorityLabel?: string | null;
  lineageHint?: string | null;
  validationIssues?: SettingValidationIssue[];

  type?: string;
  label?: string;
  value?: string | number | boolean | null;
  dirty?: boolean;
  valid?: boolean;
  validationMessage?: string;
  items?: any[];
};

export type SettingsMetric = {
  id: string;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type SettingsPanelProps = {
  title?: string;
  subtitle?: string;
  health?: SettingsHealth;
  loading?: boolean;
  settings: SettingItem[];
  metrics?: SettingsMetric[];
  selectedSettingId?: string | null;
  selectedCategory?: SettingCategory | "all";
  filterQuery?: string;
  showOnlyChanged?: boolean;
  showOnlyIssues?: boolean;
  dirty?: boolean;
  readOnly?: boolean;
  onRefreshRequested?: () => void;
  onSelectSetting?: (setting: SettingItem) => void;
  onSelectedCategoryChange?: (category: SettingCategory | "all") => void;
  onFilterQueryChange?: (query: string) => void;
  onToggleShowOnlyChanged?: (value: boolean) => void;
  onToggleShowOnlyIssues?: (value: boolean) => void;
  onDraftValueChange?: (setting: SettingItem, value: string | number | boolean | null) => void;
  onSaveRequested?: () => void;
  onResetRequested?: () => void;
};

type NormalizedSetting = SettingItem & {
  normalizedTitle: string;
  normalizedDescription: string;
  normalizedKind: SettingKind;
  normalizedCurrentValue: string | number | boolean | null;
  normalizedDraftValue: string | number | boolean | null;
  normalizedDirty: boolean;
  normalizedValid: boolean;
  normalizedValidationMessage?: string;
};

type NormalizedGroup = {
  id: string;
  description: string;
  items: NormalizedSetting[];
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function legacyKind(type: unknown): SettingKind {
  switch (type) {
    case "boolean":
      return "boolean";
    case "select":
      return "enum";
    case "number":
      return "number";
    case "path":
      return "path";
    default:
      return "string";
  }
}

function inferCategory(id: string): SettingCategory {
  if (/workspace/i.test(id)) return "workspace";
  if (/agent|provider/i.test(id)) return "providers";
  if (/editor|file/i.test(id)) return "general";
  return "general";
}

function normalizeSetting(raw: any, category: SettingCategory): NormalizedSetting {
  const kind = raw.kind ?? legacyKind(raw.type);
  const currentValue = raw.currentValue ?? raw.value ?? null;
  const draftValue = raw.draftValue ?? currentValue;
  const validationMessage =
    raw.validationMessage ??
    (Array.isArray(raw.validationIssues) && raw.validationIssues.length > 0 ? raw.validationIssues[0]?.message : undefined);

  return {
    ...raw,
    key: raw.key ?? raw.id,
    title: raw.title ?? raw.label ?? raw.id,
    category: raw.category ?? category,
    scope: raw.scope ?? "workspace",
    kind,
    currentValue,
    draftValue,
    validationIssues:
      raw.validationIssues ??
      (validationMessage
        ? [
            {
              id: `${raw.id}-validation`,
              severity: raw.valid === false ? "error" : "warn",
              message: validationMessage,
            },
          ]
        : []),
    normalizedTitle: raw.title ?? raw.label ?? raw.id,
    normalizedDescription: raw.description ?? "",
    normalizedKind: kind,
    normalizedCurrentValue: currentValue,
    normalizedDraftValue: draftValue,
    normalizedDirty: Boolean(raw.dirty ?? ((raw.draftValue !== undefined) && raw.draftValue !== currentValue)),
    normalizedValid: raw.valid !== false,
    normalizedValidationMessage: validationMessage,
  } as NormalizedSetting;
}

function normalizeGroups(settings: SettingItem[]): NormalizedGroup[] {
  const raw = settings as any[];
  if (raw.length === 0) return [];

  if (raw.some((item) => Array.isArray(item.items))) {
    return raw
      .filter((group) => Array.isArray(group.items))
      .map((group) => {
        const category = inferCategory(group.id ?? group.title ?? "");
        return {
          id: group.id ?? group.title,
          description: group.description ?? "",
          items: group.items.map((item: any) => normalizeSetting(item, category)),
        };
      });
  }

  const grouped = new Map<SettingCategory, NormalizedSetting[]>();
  raw.forEach((item) => {
    const category = item.category ?? inferCategory(item.id ?? item.key ?? "");
    const list = grouped.get(category) ?? [];
    list.push(normalizeSetting(item, category));
    grouped.set(category, list);
  });

  return Array.from(grouped.entries()).map(([category, items]) => ({
    id: category,
    description: category.replace(/-/g, " "),
    items,
  }));
}

function stringify(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function DraftControl(props: {
  setting: NormalizedSetting;
  readOnly: boolean;
  onDraftValueChange?: (setting: SettingItem, value: string | number | boolean | null) => void;
}): JSX.Element {
  const disabled = props.readOnly || props.setting.mutable === false || !props.onDraftValueChange;
  const value = props.setting.normalizedDraftValue;

  if (props.setting.normalizedKind === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => props.onDraftValueChange?.(props.setting, event.target.checked)}
        className="h-4 w-4"
      />
    );
  }

  if (props.setting.normalizedKind === "enum" && props.setting.options?.length) {
    return (
      <select
        value={stringify(value)}
        disabled={disabled}
        onChange={(event) => props.onDraftValueChange?.(props.setting, event.target.value)}
        className={cx("rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100", disabled && "opacity-50")}
      >
        {props.setting.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={props.setting.normalizedKind === "number" ? "number" : "text"}
      value={stringify(value)}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        props.onDraftValueChange?.(
          props.setting,
          props.setting.normalizedKind === "number" ? (raw === "" ? null : Number(raw)) : raw === "" ? null : raw,
        );
      }}
      className={cx("w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100", disabled && "opacity-50")}
    />
  );
}

export default function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const title = props.title ?? "Settings control plane";
  const subtitle =
    props.subtitle ??
    "Governed configuration surface for execution, review, verify, indexing, providers, diagnostics, and security posture.";

  const health = props.health ?? "unknown";
  const readOnly = props.readOnly ?? false;
  const loading = props.loading ?? false;
  const groups = useMemo(() => normalizeGroups(props.settings ?? []), [props.settings]);
  const anyDirty = props.dirty ?? groups.some((group) => group.items.some((item) => item.normalizedDirty));
  const [filter, setFilter] = useState(props.filterQuery ?? "");

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-900/70 shadow-xl">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Configuration</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-700/30 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-300">
              {health}
            </span>
            {anyDirty ? (
              <span className="rounded-full border border-amber-700/30 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-300">
                dirty
              </span>
            ) : null}
            {readOnly ? (
              <span className="rounded-full border border-zinc-700/30 bg-zinc-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                read-only
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={props.onRefreshRequested} className="rounded-2xl border border-zinc-800 px-4 py-2 text-sm text-zinc-200">
            Refresh
          </button>
          <button
            type="button"
            disabled={readOnly || !props.onSaveRequested}
            onClick={props.onSaveRequested}
            className={cx("rounded-2xl border border-indigo-700/40 px-4 py-2 text-sm text-indigo-200", (readOnly || !props.onSaveRequested) && "opacity-40")}
          >
            Save
          </button>
          <button type="button" onClick={props.onResetRequested} className="rounded-2xl border border-zinc-800 px-4 py-2 text-sm text-zinc-200">
            Reset
          </button>
        </div>

        <input
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            props.onFilterQueryChange?.(event.target.value);
          }}
          placeholder="Filter configuration"
          className="mt-4 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100"
        />
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-5">
        {loading ? <div className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">Loading configuration state…</div> : null}

        {groups.length === 0 ? (
          <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/60 p-5 text-sm text-zinc-400">
            No governed settings are currently exposed for this surface.
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.id} className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/50 p-5">
                {group.description ? <p className="text-sm leading-7 text-zinc-400">{group.description}</p> : null}
                <div className="mt-4 space-y-4">
                  {group.items.map((setting) => (
                    <article key={setting.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <div className="grid gap-4 xl:grid-cols-[1fr_18rem] xl:items-start">
                        <div>
                          <div className="text-sm font-semibold text-zinc-50">{setting.normalizedTitle}</div>
                          {setting.normalizedDescription ? (
                            <p className="mt-2 text-sm leading-7 text-zinc-400">{setting.normalizedDescription}</p>
                          ) : null}
                          {setting.normalizedValidationMessage ? (
                            <div className="mt-3 rounded-xl border border-rose-700/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                              {setting.normalizedValidationMessage}
                            </div>
                          ) : null}
                        </div>
                        <DraftControl setting={setting} readOnly={readOnly} onDraftValueChange={props.onDraftValueChange} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </section>
  );
}
