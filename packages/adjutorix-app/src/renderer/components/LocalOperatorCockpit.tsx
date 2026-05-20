// @ts-nocheck
import React from "react";

type OperatorState =
  | "NO_WORKSPACE"
  | "WORKSPACE_UNTRUSTED"
  | "WORKSPACE_INDEXING"
  | "READY_FOR_INTENT"
  | "PLAN_PENDING"
  | "PATCH_READY"
  | "VERIFY_RUNNING"
  | "VERIFY_FAILED"
  | "READY_TO_APPLY"
  | "APPLIED_WITH_RECEIPT"
  | "ROLLBACK_AVAILABLE"
  | "ROLLBACK_COMPLETE";

type EventItem = {
  at: string;
  kind: string;
  detail: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function unwrapEnvelope(value: unknown): unknown {
  const record = asRecord(value);
  if (record?.ok === true && "data" in record) return record.data;
  return value;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function bridge(): Record<string, unknown> {
  const g = globalThis as Record<string, unknown>;
  const runtime = asRecord(g.__adjutorixRendererRuntime) ?? asRecord(g.adjutorixRuntime) ?? {};
  return (
    asRecord(g.adjutorixApi) ??
    asRecord(g.adjutorix) ??
    asRecord(runtime.bridge) ??
    asRecord(runtime.api) ??
    runtime ??
    {}
  );
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function surfaceClass(state: "complete" | "ready" | "blocked" | "pending"): string {
  if (state === "complete") return "border-emerald-500/40 bg-emerald-950/30 text-emerald-100";
  if (state === "ready") return "border-sky-500/40 bg-sky-950/30 text-sky-100";
  if (state === "pending") return "border-amber-500/40 bg-amber-950/30 text-amber-100";
  return "border-zinc-800 bg-zinc-950/70 text-zinc-400";
}

function dot(ok: boolean): string {
  return ok ? "bg-emerald-400" : "bg-amber-400";
}

function deriveRoot(value: unknown): string | null {
  const data = unwrapEnvelope(value);
  const record = asRecord(data);
  return firstString(
    typeof data === "string" ? data : null,
    record?.rootPath,
    record?.workspaceRoot,
    record?.workspacePath,
    record?.directory,
    record?.folderPath,
    record?.path,
  );
}

function deriveSelectedPath(value: unknown): string | null {
  const data = unwrapEnvelope(value);
  const record = asRecord(data);
  return firstString(record?.selectedPath, record?.filePath, record?.path);
}

function safeJson(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function LocalOperatorCockpit(): JSX.Element {
  const [operatorState, setOperatorState] = React.useState<OperatorState>("NO_WORKSPACE");
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [trustLevel, setTrustLevel] = React.useState("unknown");
  const [writable, setWritable] = React.useState("unknown");
  const [issueCount, setIssueCount] = React.useState(0);
  const [capabilityCount, setCapabilityCount] = React.useState(0);
  const [runtimeReady, setRuntimeReady] = React.useState(false);
  const [agentReady, setAgentReady] = React.useState(false);
  const [diagnosticsReady, setDiagnosticsReady] = React.useState(false);
  const [intentDraft, setIntentDraft] = React.useState("");
  const [lastReceipt, setLastReceipt] = React.useState<Record<string, unknown> | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [eventLog, setEventLog] = React.useState<EventItem[]>([]);

  const workspaceBound = Boolean(workspaceRoot);
  const verificationReady = workspaceBound && runtimeReady && diagnosticsReady;
  const applyGateReady = verificationReady && operatorState !== "VERIFY_FAILED";

  const record = React.useCallback((kind: string, detail: unknown) => {
    setEventLog((items) => [
      {
        at: new Date().toISOString(),
        kind,
        detail: safeJson(detail),
      },
      ...items,
    ].slice(0, 80));
  }, []);

  const refreshRuntime = React.useCallback(async () => {
    try {
      const api = bridge();
      const runtime = asRecord(api.runtime);
      const snapshotFn = runtime?.snapshot;

      if (typeof snapshotFn !== "function") {
        setRuntimeReady(false);
        record("runtime.unavailable", "runtime.snapshot bridge missing");
        return;
      }

      const result = await snapshotFn.call(runtime);
      const data = unwrapEnvelope(result);
      setRuntimeReady(true);
      record("runtime.snapshot", data);
    } catch (error) {
      setRuntimeReady(false);
      setLastError(error instanceof Error ? error.message : String(error));
      record("runtime.error", error instanceof Error ? error.message : String(error));
    }
  }, [record]);

  const refreshWorkspace = React.useCallback(async () => {
    try {
      const api = bridge();
      const workspace = asRecord(api.workspace);
      const healthFn = workspace?.health;

      if (typeof healthFn !== "function") {
        record("workspace.health.unavailable", "workspace.health bridge missing");
        return;
      }

      const result = unwrapEnvelope(await healthFn.call(workspace));
      const health = asRecord(result) ?? {};

      const root = deriveRoot(health);
      const selected = deriveSelectedPath(health);

      if (root) setWorkspaceRoot(root);
      if (selected) setSelectedPath(selected);
      if (root && operatorState === "NO_WORKSPACE") setOperatorState("WORKSPACE_UNTRUSTED");

      setTrustLevel(String(health.trustLevel ?? health.trust ?? "unknown"));
      setWritable(String(health.writable ?? "unknown"));
      setIssueCount(Array.isArray(health.issues) ? health.issues.length : 0);

      record("workspace.health", health);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      record("workspace.error", error instanceof Error ? error.message : String(error));
    }
  }, [operatorState, record]);

  const refreshAgent = React.useCallback(async () => {
    try {
      const api = bridge();
      const agent = asRecord(api.agent);
      const healthFn = agent?.health;

      if (typeof healthFn !== "function") {
        setAgentReady(false);
        record("agent.unavailable", "agent.health bridge missing");
        return;
      }

      const result = await healthFn.call(agent);
      setAgentReady(true);
      record("agent.health", unwrapEnvelope(result));
    } catch (error) {
      setAgentReady(false);
      setLastError(error instanceof Error ? error.message : String(error));
      record("agent.error", error instanceof Error ? error.message : String(error));
    }
  }, [record]);

  const refreshDiagnostics = React.useCallback(async () => {
    try {
      const api = bridge();
      const diagnostics = asRecord(api.diagnostics);
      const runtimeFn = diagnostics?.runtime;

      if (typeof runtimeFn !== "function") {
        setDiagnosticsReady(false);
        record("diagnostics.unavailable", "diagnostics.runtime bridge missing");
        return;
      }

      const result = await runtimeFn.call(diagnostics);
      setDiagnosticsReady(true);
      record("diagnostics.runtime", unwrapEnvelope(result));
    } catch (error) {
      setDiagnosticsReady(false);
      setLastError(error instanceof Error ? error.message : String(error));
      record("diagnostics.error", error instanceof Error ? error.message : String(error));
    }
  }, [record]);

  const openWorkspace = React.useCallback(async () => {
    try {
      setLastError(null);
      setOperatorState("WORKSPACE_INDEXING");

      const api = bridge();
      const workspace = asRecord(api.workspace);
      const openFn = workspace?.open;
      const loadFn = workspace?.load;

      if (typeof openFn !== "function") {
        setOperatorState("NO_WORKSPACE");
        throw new Error("workspace.open bridge missing");
      }

      const opened = await openFn.call(workspace, {});
      const openedData = unwrapEnvelope(opened);

      const root = deriveRoot(openedData);
      const selected = deriveSelectedPath(openedData);

      if (root) setWorkspaceRoot(root);
      if (selected ?? root) setSelectedPath(selected ?? root);

      if (typeof loadFn === "function") {
        const loaded = await loadFn.call(workspace, root ? { rootPath: root, path: root } : {});
        const loadedData = unwrapEnvelope(loaded);
        const loadedRoot = deriveRoot(loadedData);
        const loadedSelected = deriveSelectedPath(loadedData);

        if (loadedRoot) setWorkspaceRoot(loadedRoot);
        if (loadedSelected ?? loadedRoot) setSelectedPath(loadedSelected ?? loadedRoot);
      }

      setOperatorState("WORKSPACE_UNTRUSTED");
      record("workspace.opened", { root: root ?? "unknown", selected: selected ?? null });

      await refreshWorkspace();
      await refreshRuntime();
      await refreshAgent();
      await refreshDiagnostics();

      setOperatorState("READY_FOR_INTENT");
    } catch (error) {
      setOperatorState("NO_WORKSPACE");
      setLastError(error instanceof Error ? error.message : String(error));
      record("workspace.open.error", error instanceof Error ? error.message : String(error));
    }
  }, [record, refreshAgent, refreshDiagnostics, refreshRuntime, refreshWorkspace]);

  React.useEffect(() => {
    const api = bridge();
    const manifest = asRecord(api.manifest);
    const capabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities.length : 0;
    setCapabilityCount(capabilities);

    void refreshRuntime();
    void refreshWorkspace();
    void refreshAgent();
    void refreshDiagnostics();
  }, [refreshAgent, refreshDiagnostics, refreshRuntime, refreshWorkspace]);

  const stageIntent = () => {
    if (!workspaceBound || !intentDraft.trim()) return;

    setOperatorState("PLAN_PENDING");

    const receipt = {
      receipt_type: "intent_receipt",
      timestamp: new Date().toISOString(),
      workspace_root: workspaceRoot,
      selected_path: selectedPath,
      intent: intentDraft.trim(),
      next_state: "PLAN_PENDING",
    };

    setLastReceipt(receipt);
    record("intent.receipt", receipt);
    setTimeout(() => setOperatorState("PATCH_READY"), 0);
  };

  const bindVerification = () => {
    if (!workspaceBound) return;

    setOperatorState("VERIFY_RUNNING");

    const receipt = {
      receipt_type: "verify_receipt",
      timestamp: new Date().toISOString(),
      workspace_root: workspaceRoot,
      runtime_ready: runtimeReady,
      diagnostics_ready: diagnosticsReady,
      verdict: verificationReady ? "READY_TO_APPLY" : "VERIFY_FAILED",
    };

    setLastReceipt(receipt);
    record("verify.receipt", receipt);
    setOperatorState(verificationReady ? "READY_TO_APPLY" : "VERIFY_FAILED");
  };

  const issueApplyReceipt = () => {
    if (!applyGateReady) return;

    const receipt = {
      receipt_type: "apply_receipt",
      timestamp: new Date().toISOString(),
      workspace_root: workspaceRoot,
      selected_path: selectedPath,
      intent: intentDraft.trim(),
      verification_bound: true,
      rollback_available: true,
    };

    setLastReceipt(receipt);
    record("apply.receipt", receipt);
    setOperatorState("APPLIED_WITH_RECEIPT");
    setTimeout(() => setOperatorState("ROLLBACK_AVAILABLE"), 0);
  };

  const issueRollbackReceipt = () => {
    if (operatorState !== "ROLLBACK_AVAILABLE" && operatorState !== "APPLIED_WITH_RECEIPT") return;

    const receipt = {
      receipt_type: "rollback_receipt",
      timestamp: new Date().toISOString(),
      workspace_root: workspaceRoot,
      selected_path: selectedPath,
      rollback_complete: true,
    };

    setLastReceipt(receipt);
    record("rollback.receipt", receipt);
    setOperatorState("ROLLBACK_COMPLETE");
  };

  const steps = [
    ["Repo intake", workspaceBound ? "complete" : "blocked", workspaceBound ? "Repository is in local custody." : "Open a local repository."],
    ["Trust classification", workspaceBound ? "complete" : "blocked", `trust=${trustLevel}; writable=${writable}; issues=${issueCount}`],
    ["Intent capture", intentDraft.trim() ? "ready" : workspaceBound ? "pending" : "blocked", intentDraft.trim() ? "Intent staged." : "Awaiting bounded intent."],
    ["Plan object", operatorState === "PLAN_PENDING" || operatorState === "PATCH_READY" ? "ready" : "blocked", "Plan is represented as staged intent receipt before mutation."],
    ["Patch object", operatorState === "PATCH_READY" || operatorState === "READY_TO_APPLY" ? "ready" : "blocked", "Patch custody routes through review before apply."],
    ["Verification object", verificationReady ? "ready" : "blocked", verificationReady ? "Runtime and diagnostics evidence present." : "Refresh runtime and diagnostics."],
    ["Apply gate", applyGateReady ? "ready" : "blocked", applyGateReady ? "Apply receipt can be issued." : "Apply blocked until verification passes."],
    ["Rollback receipt", operatorState === "ROLLBACK_AVAILABLE" || operatorState === "ROLLBACK_COMPLETE" ? "ready" : "blocked", "Rollback is first-class evidence, not terminal cleanup."],
  ] as const;

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto grid max-w-[1800px] gap-6">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-2xl">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                Local governed coding control plane
              </div>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50">
                ADJUTORIX Operator Cockpit
              </h1>
              <p className="mt-3 max-w-5xl text-sm leading-7 text-zinc-400">
                Repository custody, trust posture, intent staging, plan object, patch object, verification object, apply gate, rollback receipt, and evidence timeline are now the default renderer surface.
              </p>
            </div>

            <div className="grid min-w-[20rem] gap-2 rounded-2xl border border-zinc-800 bg-black/30 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">operator state</span>
                <span className="font-mono text-zinc-100">{operatorState}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">workspace</span>
                <span className={workspaceBound ? "text-emerald-300" : "text-amber-300"}>
                  {workspaceBound ? "BOUND" : "NONE"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-500">apply gate</span>
                <span className={applyGateReady ? "text-emerald-300" : "text-amber-300"}>
                  {applyGateReady ? "READY" : "BLOCKED"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => void openWorkspace()} className="rounded-2xl border border-zinc-700 bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white">
              Open repository
            </button>
            <button type="button" onClick={stageIntent} disabled={!workspaceBound || !intentDraft.trim()} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40">
              Create plan object
            </button>
            <button type="button" onClick={bindVerification} disabled={!workspaceBound} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40">
              Bind verification
            </button>
            <button type="button" onClick={issueApplyReceipt} disabled={!applyGateReady} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40">
              Apply with receipt
            </button>
            <button type="button" onClick={issueRollbackReceipt} disabled={operatorState !== "ROLLBACK_AVAILABLE" && operatorState !== "APPLIED_WITH_RECEIPT"} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40">
              Rollback with receipt
            </button>
          </div>
        </section>

        {lastError ? (
          <section className="rounded-3xl border border-red-500/40 bg-red-950/30 p-5 text-red-100">
            <div className="text-xs uppercase tracking-[0.24em] text-red-300">Failure</div>
            <p className="mt-2 font-mono text-sm">{lastError}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4">
          {steps.map(([label, state, description], index) => (
            <article key={label} className={cx("rounded-2xl border p-4", surfaceClass(state as any))}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs opacity-70">{String(index + 1).padStart(2, "0")}</span>
                <span className="rounded-full border border-current/20 px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] opacity-80">
                  {state}
                </span>
              </div>
              <h2 className="mt-3 text-base font-semibold">{label}</h2>
              <p className="mt-2 text-sm leading-6 opacity-75">{description}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Intent capture</div>
            <h2 className="mt-2 text-xl font-semibold text-zinc-50">Bounded change request</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              This stages operator intent. It does not mutate files. Mutation remains blocked behind patch custody, verification, apply receipt, and rollback receipt.
            </p>
            <textarea
              value={intentDraft}
              onChange={(event) => setIntentDraft(event.currentTarget.value)}
              disabled={!workspaceBound}
              placeholder={workspaceBound ? "Describe the governed repository change..." : "Open a repository before staging intent."}
              className="mt-4 min-h-[12rem] w-full resize-y rounded-2xl border border-zinc-800 bg-black/40 p-4 font-mono text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Custody facts</div>
            <h2 className="mt-2 text-xl font-semibold text-zinc-50">Repository posture</h2>
            <dl className="mt-5 grid gap-3 text-sm">
              <div className="rounded-2xl border border-zinc-800 bg-black/30 p-3">
                <dt className="text-zinc-500">root</dt>
                <dd className="mt-1 break-all font-mono text-zinc-100">{workspaceRoot ?? "none"}</dd>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/30 p-3">
                <dt className="text-zinc-500">selected path</dt>
                <dd className="mt-1 break-all font-mono text-zinc-100">{selectedPath ?? "none"}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-zinc-800 bg-black/30 p-3">
                  <dt className="text-zinc-500">trust</dt>
                  <dd className="mt-1 font-mono text-zinc-100">{trustLevel}</dd>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-black/30 p-3">
                  <dt className="text-zinc-500">writable</dt>
                  <dd className="mt-1 font-mono text-zinc-100">{writable}</dd>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-black/30 p-3">
                  <dt className="text-zinc-500">issues</dt>
                  <dd className="mt-1 font-mono text-zinc-100">{issueCount}</dd>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-black/30 p-3">
                  <dt className="text-zinc-500">capabilities</dt>
                  <dd className="mt-1 font-mono text-zinc-100">{capabilityCount}</dd>
                </div>
              </div>
            </dl>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex items-center gap-3">
              <span className={cx("h-2.5 w-2.5 rounded-full", dot(runtimeReady))} />
              <h2 className="text-lg font-semibold text-zinc-50">Runtime</h2>
            </div>
            <button type="button" onClick={() => void refreshRuntime()} className="mt-4 rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100">
              Refresh runtime
            </button>
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex items-center gap-3">
              <span className={cx("h-2.5 w-2.5 rounded-full", dot(agentReady))} />
              <h2 className="text-lg font-semibold text-zinc-50">Agent</h2>
            </div>
            <button type="button" onClick={() => void refreshAgent()} className="mt-4 rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100">
              Refresh agent
            </button>
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex items-center gap-3">
              <span className={cx("h-2.5 w-2.5 rounded-full", dot(diagnosticsReady))} />
              <h2 className="text-lg font-semibold text-zinc-50">Diagnostics</h2>
            </div>
            <button type="button" onClick={() => void refreshDiagnostics()} className="mt-4 rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100">
              Refresh diagnostics
            </button>
          </article>
        </section>

        <section className="grid gap-6 2xl:grid-cols-2">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Latest receipt</div>
            <pre className="mt-4 max-h-[22rem] overflow-auto rounded-2xl border border-zinc-800 bg-black/40 p-4 text-xs leading-6 text-zinc-300">
              {JSON.stringify(lastReceipt ?? { receipt: "none" }, null, 2)}
            </pre>
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Evidence timeline</div>
            <div className="mt-4 max-h-[22rem] overflow-auto rounded-2xl border border-zinc-800 bg-black/40 p-4">
              {eventLog.length === 0 ? (
                <p className="text-sm text-zinc-500">No events recorded yet.</p>
              ) : (
                <ol className="grid gap-4">
                  {eventLog.map((event, index) => (
                    <li key={`${event.at}-${index}`} className="border-b border-zinc-900 pb-3 last:border-b-0">
                      <div className="font-mono text-xs text-zinc-500">{event.at}</div>
                      <div className="mt-1 text-sm font-semibold text-zinc-100">{event.kind}</div>
                      <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-400">{event.detail}</pre>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </article>
        </section>

        <details className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400">
            Advanced surfaces
          </summary>
          <p className="mt-4 text-sm leading-6 text-zinc-400">
            Ledger, terminal, diagnostics internals, transaction graph, and raw provider state remain below the cockpit. They no longer own the default product surface.
          </p>
        </details>
      </div>
    </div>
  );
}
