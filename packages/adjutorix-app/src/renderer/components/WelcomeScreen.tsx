import React from "react";

export type WelcomeHealth = "healthy" | "degraded" | "unhealthy" | "unknown";
export type WelcomeTrustLevel = "untrusted" | "restricted" | "trusted" | "unknown";

export type WelcomeAction = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  onClick?: () => void;
};

export type WelcomeInvariant = {
  id: string;
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
};

export type WelcomeQuickLink = {
  id: string;
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
};

export type WelcomeCapability = {
  id: string;
  title: string;
  description: string;
  status?: "ready" | "blocked" | "degraded" | "unknown";
};

export type WelcomeRecentWorkspace = {
  id: string;
  name: string;
  path: string;
  trustLevel?: WelcomeTrustLevel;
  health?: WelcomeHealth;
  diagnosticsCount?: number;
  pendingReviewCount?: number;
  lastOpenedAtMs?: number | null;
  onClick?: () => void;
  disabled?: boolean;
};

export type WelcomeScreenProps = {
  productName?: string;
  title?: string;
  subtitle?: string;
  trustLevel?: WelcomeTrustLevel;
  health?: WelcomeHealth;
  loading?: boolean;
  workspaceRoot?: string | null;
  blockingMessage?: string | null;
  diagnosticsHint?: string | null;
  primaryAction?: WelcomeAction;
  secondaryActions?: WelcomeAction[];
  quickLinks?: WelcomeQuickLink[];
  capabilities?: WelcomeCapability[];
  invariants?: WelcomeInvariant[];
  recentWorkspaces?: WelcomeRecentWorkspace[];
  notes?: string[];
  footerNote?: string | null;
  onOpenWorkspace?: () => void;
  onOpenRecentWorkspace?: (workspace: WelcomeRecentWorkspace) => void;
  onShowSettings?: () => void;
  onShowAbout?: () => void;
  onShowCommandPalette?: () => void;
};

const DEFAULT_CAPABILITIES: WelcomeCapability[] = [
  {
    id: "open-workspace",
    title: "Open workspace",
    description: "Choose a repository or working directory to establish governed workspace truth.",
    status: "ready",
  },
  {
    id: "resume-recent",
    title: "Resume recent work",
    description: "Recover a previously indexed or reviewed workspace without re-discovering operator context.",
    status: "ready",
  },
  {
    id: "agent-readiness",
    title: "Agent readiness",
    description: "See provider and auth posture before issuing model-backed commands.",
    status: "ready",
  },
];

const DEFAULT_INVARIANTS: WelcomeInvariant[] = [
  {
    id: "no-ambiguous-mutation",
    title: "The system refuses ambiguous mutation",
    description: "Every material action is explicit, reviewable, and surfaced before irreversible effects occur.",
  },
  {
    id: "explicit-start",
    title: "Start from an explicit action",
    description: "Workspace admission, diagnostics, settings, and command routing remain separate operator choices.",
  },
  {
    id: "trust-context",
    title: "Re-enter with explicit trust context",
    description: "Recent workspaces retain path, trust, health, and review posture as concrete recovery targets.",
  },
];

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatTime(ts?: number | null): string {
  if (!ts) return "Unknown";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function tone(value?: string): string {
  switch (value) {
    case "trusted":
    case "healthy":
    case "ready":
      return "border-emerald-700/30 bg-emerald-500/10 text-emerald-300";
    case "restricted":
    case "degraded":
      return "border-amber-700/30 bg-amber-500/10 text-amber-300";
    case "untrusted":
    case "unhealthy":
    case "blocked":
      return "border-rose-700/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-zinc-700/30 bg-zinc-500/10 text-zinc-300";
  }
}

function Badge(props: { children: React.ReactNode; value?: string }): JSX.Element {
  return (
    <span className={cx("rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em]", tone(props.value))}>
      {props.children}
    </span>
  );
}

function ActionButton(props: { action: WelcomeAction; ariaLabel?: string }): JSX.Element {
  const disabled = props.action.disabled || !props.action.onClick;
  return (
    <button
      aria-label={props.ariaLabel}
      type="button"
      disabled={disabled}
      onClick={props.action.onClick}
      className={cx(
        "rounded-2xl border px-5 py-3 text-sm font-semibold",
        props.action.tone === "secondary"
          ? "border-zinc-800 bg-zinc-950 text-zinc-100"
          : "border-indigo-700/40 bg-indigo-500/15 text-indigo-200",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {props.action.label}
    </button>
  );
}

export default function WelcomeScreen(props: WelcomeScreenProps): JSX.Element {
  const health = props.health ?? "unknown";
  const productName = props.productName ?? "ADJUTORIX";
  const title = props.title ?? "Governed execution begins with an explicit workspace";
  const subtitle =
    props.subtitle ??
    "Open a repository, establish trust posture, inspect system readiness, and move through preview, review, verify, and apply without hidden mutation.";

  const primaryAction: WelcomeAction =
    props.primaryAction ??
    ({
      id: "open-workspace",
      label: "Open workspace",
      tone: "primary",
      onClick: props.onOpenWorkspace,
    } satisfies WelcomeAction);

  const secondaryActions: WelcomeAction[] =
    props.secondaryActions ??
    [
      { id: "settings", label: "Settings", tone: "secondary", onClick: props.onShowSettings },
      { id: "about", label: "About", tone: "secondary", onClick: props.onShowAbout },
      { id: "command-palette", label: "Command palette", tone: "secondary", onClick: props.onShowCommandPalette },
    ];

  const capabilities =
    props.capabilities ??
    props.quickLinks?.map((link) => ({
      id: link.id,
      title: link.title,
      description: link.description,
      status: link.disabled ? "blocked" : "ready",
    })) ??
    DEFAULT_CAPABILITIES;

  const invariants = props.invariants ?? DEFAULT_INVARIANTS;
  const recentWorkspaces = props.recentWorkspaces ?? [];
  const notes = props.notes ?? [
    "No workspace is currently attached.",
    "Opening a workspace establishes the root for file tree, diagnostics, indexing, and patch review.",
  ];

  const totalPendingReview = recentWorkspaces.reduce((sum, item) => sum + (item.pendingReviewCount ?? 0), 0);
  const showRecentHealth = health === "healthy";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-6 py-8 lg:px-8 xl:py-10">
        {(health !== "healthy" || props.blockingMessage || props.diagnosticsHint || props.loading) && (
          <section className="rounded-[2rem] border border-amber-700/30 bg-amber-500/10 px-5 py-4 text-amber-200">
            <div className="text-sm font-semibold uppercase tracking-[0.2em]">Admission posture requires review</div>
            {props.loading ? <div className="mt-2 text-sm">Admission context is hydrating.</div> : null}
            {props.blockingMessage ? <div className="mt-2 text-sm">{props.blockingMessage}</div> : null}
            {props.diagnosticsHint ? <div className="mt-2 text-sm">{props.diagnosticsHint}</div> : null}
          </section>
        )}

        <section className="rounded-[2.25rem] border border-zinc-800 bg-zinc-900/70 p-8 shadow-2xl">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-400">{productName}</div>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-zinc-400">{subtitle}</p>

          {props.workspaceRoot ? (
            <div className="mt-5 break-all rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300">
              {props.workspaceRoot}
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            <ActionButton action={primaryAction} ariaLabel="Open workspace" />
            {secondaryActions.map((action) => (
              <ActionButton key={action.id} action={action} />
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/60 shadow-xl">
          <div className="border-b border-zinc-800 px-6 py-5">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Capabilities</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Start from an explicit action</h2>
          </div>
          <div className="grid gap-4 p-6 md:grid-cols-3">
            {capabilities.map((capability) => (
              <article key={capability.id} className="rounded-[2rem] border border-zinc-800 bg-zinc-950/60 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="text-base font-semibold text-zinc-50">{capability.title}</div>
                  {capability.status ? <Badge value={capability.status}>{capability.status}</Badge> : null}
                </div>
                <p className="mt-3 text-sm leading-7 text-zinc-400">{capability.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/60 shadow-xl">
          <div className="border-b border-zinc-800 px-6 py-5">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Recovery</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Resume recent work</h2>
          </div>
          <div className="grid gap-4 p-6 md:grid-cols-2">
            {recentWorkspaces.length === 0 ? (
              <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/60 p-5 text-sm text-zinc-400">
                No recent workspaces have been recorded yet.
              </div>
            ) : (
              recentWorkspaces.map((workspace) => {
                const disabled = workspace.disabled || (!workspace.onClick && !props.onOpenRecentWorkspace);
                const handleClick = workspace.onClick ?? (() => props.onOpenRecentWorkspace?.(workspace));
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    disabled={disabled}
                    onClick={handleClick}
                    className={cx(
                      "w-full rounded-[2rem] border border-zinc-800 bg-zinc-950/60 p-5 text-left shadow-lg",
                      disabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <div className="break-all text-sm font-semibold text-zinc-50">{workspace.path}</div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {workspace.trustLevel && workspace.trustLevel !== "trusted" ? (
                        <Badge value={workspace.trustLevel}>{workspace.trustLevel}</Badge>
                      ) : null}
                      {showRecentHealth && workspace.health ? <Badge value={workspace.health}>{workspace.health}</Badge> : null}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-4 text-xs text-zinc-500">
                      <span>Last opened</span>
                      <span>{formatTime(workspace.lastOpenedAtMs)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {totalPendingReview > 0 ? (
            <div className="border-t border-zinc-800 px-6 py-4 text-sm text-zinc-400">{totalPendingReview} pending review</div>
          ) : null}
        </section>

        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/60 shadow-xl">
          <div className="border-b border-zinc-800 px-6 py-5">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Notes</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Re-enter with explicit trust context</h2>
          </div>
          <div className="space-y-3 p-6">
            {notes.map((note, index) => (
              <div key={`${index}-${note}`} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300">
                {note}
              </div>
            ))}
            {props.footerNote ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300">{props.footerNote}</div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {invariants.map((item) => (
            <article key={item.id} className="rounded-[2rem] border border-zinc-800 bg-zinc-900/60 p-5">
              <h2 className="text-base font-semibold text-zinc-50">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-zinc-400">{item.description}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
