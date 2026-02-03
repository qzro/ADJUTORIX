import * as vscode from "vscode";
import { RpcClient } from "../client/rpc";
import { RpcError } from "../client/types";
import type { JobStatus } from "../types/engineProtocol";
import { ENGINE_PROTOCOL_VERSION } from "../types/engineProtocol";
import type { AgentProcessManager, AgentProcessStatus } from "../agent/processManager";
import { classifyError } from "../agent/processManager";

const PING_INTERVAL_MS = 3_000;
const PING_BACKOFF_INITIAL_MS = 2_000;
const PING_BACKOFF_MAX_MS = 30_000;
const TRANSCRIPT_KEY = "adjutorix.transcript.v2";
const MAX_TRANSCRIPT_ENTRIES = 100;
/** Use single source of truth; prevents drift from agent protocol. */
const PROTOCOL_VERSION = ENGINE_PROTOCOL_VERSION;
const JOB_POLL_MS = 500;

export interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  text: string;
  engine?: string;
}

/** Chat RPC returns envelope only. No raw string. */
export interface ChatEnvelope {
  type: string;
  trace_id?: string;
  engine?: string;
  payload?: {
    code?: string;
    message?: string;
    text?: string;
    suggested?: string[];
    goal?: string;
    steps?: { id?: string; action?: string; tool?: string }[];
    commands?: string[];
  };
}

function formatEnvelope(env: ChatEnvelope): string {
  const t = env?.type || "unknown";
  const p = env?.payload || {};
  if (t === "reject") return `Rejected: ${p.message ?? "Unknown"}`;
  if (t === "questions_needed") {
    const suggested = Array.isArray(p.suggested) ? p.suggested : [];
    const s = suggested.length ? "\n- " + suggested.join("\n- ") : "";
    return `${p.message ?? "Questions needed."}${s}`;
  }
  if (t === "plan") {
    const steps = Array.isArray(p.steps) ? p.steps : [];
    const cmds = Array.isArray(p.commands) ? p.commands : [];
    const stepLines = steps.length
      ? "\n" + steps.map((x) => `- [${x.id ?? "?"}] ${x.action}${x.tool ? ` (${x.tool})` : ""}`).join("\n")
      : "";
    const cmdLine = cmds.length ? `\n\nCommands: ${cmds.join(" ")}` : "";
    return `Plan: ${p.goal ?? "—"}${stepLines}${cmdLine}`;
  }
  if (t === "report") return p.text ?? "Report ready.";
  return JSON.stringify(env, null, 2);
}

/**
 * Webview view provider for the ADJUTORIX sidebar.
 * Renders Chat + Actions: status, transcript, input, Check/Fix/Verify/Deploy.
 * When AgentProcessManager is provided, owns lifecycle (auto-start, status, Retry/Open Logs, periodic ping + backoff).
 * Transcript is persisted in workspaceState; Clear resets it.
 */
export class AdjutorixViewProvider implements vscode.WebviewViewProvider {
  private currentView: vscode.WebviewView | null = null;
  private statusSubscription: vscode.Disposable | null = null;
  private pingTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingBackoffMs = PING_INTERVAL_MS;
  private lastPingLoggedAt = 0;
  private lastPingWasOk: boolean | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly rpcClient: RpcClient,
    private readonly out: vscode.OutputChannel,
    private readonly agentProcessManager: AgentProcessManager | null,
    private readonly workspaceState: vscode.Memento
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Promise<void> {
    this.out.appendLine("[view] resolveWebviewView()");
    this.currentView = webviewView;

    const entries = this.getTranscript();
    const hasRawJson = entries.some((e) => e.text.trim().startsWith('{"type":'));
    if (hasRawJson) {
      void this.clearTranscript().then(() => this.safeSendTranscript());
    }

    const uiSession = Math.random().toString(16).slice(2);
    this.out.appendLine(`[ui] session=${uiSession}`);

    webviewView.onDidDispose(() => {
      this.out.appendLine(`[ui] disposed session=${uiSession}`);
      this.clearPingTimer();
      if (this.statusSubscription) {
        this.statusSubscription.dispose();
        this.statusSubscription = null;
      }
      this.currentView = null;
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview, uiSession);

    if (this.agentProcessManager) {
      const pushStatus = (status: AgentProcessStatus) => {
        this.postStatus(webviewView, status);
      };
      pushStatus(this.agentProcessManager.getStatus());
      this.statusSubscription = this.agentProcessManager.onStatusChange(pushStatus);

      // VSC-only controller: start when view resolves unless mode is external or managed-policy mismatch.
      const st = this.agentProcessManager.getStatus();
      const isManagedPolicyMismatch =
        st.mode === "managed" &&
        st.lastErrorRaw &&
        (st.lastErrorRaw.startsWith("managed policy:") ||
          st.lastErrorRaw.includes("mode mismatch (managed)"));
      if (
        st.mode !== "external" &&
        (st.state === "stopped" || st.state === "failed") &&
        !isManagedPolicyMismatch
      ) {
        this.agentProcessManager.start().catch((e) => {
          this.out.appendLine(`[view] start failed: ${e}`);
        });
      }

      this.schedulePing(webviewView);
    } else {
      this.pingAndUpdateStatus(webviewView);
    }

    webviewView.webview.onDidReceiveMessage(async (msg: { type: string; payload?: unknown }) => {
      if (msg.type !== "setMode") this.out.appendLine(`[view] msg: ${JSON.stringify(msg)}`);
      switch (msg.type) {
        case "log":
          this.out.appendLine(`[view] ${String((msg as { payload?: unknown }).payload ?? "")}`);
          break;
        case "ready":
          if (this.agentProcessManager) {
            this.postStatus(webviewView, this.agentProcessManager.getStatus());
          } else {
            await this.pingAndUpdateStatus(webviewView);
          }
          this.safeSendTranscript();
          break;
        case "action": {
          const p = msg.payload as { action?: string; confirm?: boolean };
          const action = typeof p === "string" ? p : (p?.action ?? "check");
          const confirm = typeof p === "object" && p?.confirm === true;
          await this.runAction(webviewView, action, { confirm });
          break;
        }
        case "chat":
          await this.runChat(webviewView, msg.payload as { message: string; context?: unknown });
          break;
        case "retry":
          await this.handleRetry(webviewView);
          break;
        case "openLogs":
          this.out.show(true);
          break;
        case "clearTranscript":
          this.clearTranscript();
          this.safeSendTranscript();
          break;
        case "patchList":
          await this.handlePatchList(webviewView);
          break;
        case "patchGet": {
          const patchId = (msg.payload as { patch_id?: string })?.patch_id;
          if (patchId) await this.handlePatchGet(webviewView, patchId);
          break;
        }
        case "patchAccept": {
          const patchId = (msg.payload as { patch_id?: string })?.patch_id;
          if (patchId) await this.handlePatchAccept(webviewView, patchId);
          break;
        }
        case "patchReject": {
          const patchId = (msg.payload as { patch_id?: string })?.patch_id;
          if (patchId) await this.handlePatchReject(webviewView, patchId);
          break;
        }
        case "patchApply": {
          const patchId = (msg.payload as { patch_id?: string })?.patch_id;
          if (patchId) await this.handlePatchApply(webviewView, patchId);
          break;
        }
        case "setMode": {
          const mode = (msg.payload as { mode?: string })?.mode;
          if (
            this.agentProcessManager &&
            (mode === "auto" || mode === "managed" || mode === "external")
          ) {
            this.agentProcessManager.setMode(mode);
            this.postStatus(webviewView, this.agentProcessManager.getStatus());
            if (mode !== "external") {
              this.agentProcessManager.start().catch((e) =>
                this.out.appendLine(`[mode] start failed: ${e}`)
              );
            }
          }
          break;
        }
        default:
          break;
      }
    });
  }

  private clearPingTimer(): void {
    if (this.pingTimeout != null) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  private schedulePing(webviewView: vscode.WebviewView): void {
    this.clearPingTimer();
    if (!this.agentProcessManager || !this.currentView) return;

    const state = this.agentProcessManager.getStatus().state;
    if (state === "stopping" || state === "starting") {
      this.pingTimeout = setTimeout(() => {
        this.pingTimeout = null;
        this.schedulePing(webviewView);
      }, 1000);
      return;
    }

    this.pingTimeout = setTimeout(async () => {
      this.pingTimeout = null;
      if (!this.currentView || !this.agentProcessManager) return;
      const ok = await this.agentProcessManager.ping();
      const status = this.agentProcessManager.getStatus();
      const now = Date.now();
      if (ok) {
        this.pingBackoffMs = PING_INTERVAL_MS;
        const shouldLogOk =
          this.lastPingWasOk !== true || now - this.lastPingLoggedAt > 30_000;
        if (shouldLogOk) {
          this.out.appendLine(`[ping] ok (${status.baseUrl})`);
          this.lastPingLoggedAt = now;
        }
        this.lastPingWasOk = true;
      } else {
        this.pingBackoffMs = Math.min(
          this.pingBackoffMs * 2 || PING_BACKOFF_INITIAL_MS,
          PING_BACKOFF_MAX_MS
        );
        const shouldLogFail =
          this.lastPingWasOk !== false || now - this.lastPingLoggedAt > 30_000;
        if (shouldLogFail) {
          this.out.appendLine(`[ping] fail: ${status.lastError ?? "unknown"}`);
          this.lastPingLoggedAt = now;
        }
        this.lastPingWasOk = false;
      }
      this.schedulePing(webviewView);
    }, this.pingBackoffMs);
  }

  private async handleRetry(webviewView: vscode.WebviewView): Promise<void> {
    if (!this.agentProcessManager) {
      await this.pingAndUpdateStatus(webviewView);
      return;
    }
    const st = this.agentProcessManager.getStatus();
    if (st.state === "starting" || st.state === "stopping") {
      return;
    }
    if (st.state === "failed" || st.state === "stopped") {
      this.agentProcessManager.start().catch((e) => {
        this.out.appendLine(`[view] retry start failed: ${e}`);
      });
      return;
    }
    if (st.state === "connected") {
      await this.agentProcessManager.ping();
      this.postStatus(webviewView, this.agentProcessManager.getStatus());
    }
  }

  /** Single place to sync transport (endpoint + auth) from status. */
  private configureTransport(status: AgentProcessStatus): void {
    this.rpcClient.setEndpoint(`${status.baseUrl}/rpc`);
  }

  private async fetchCapabilitiesAndNotify(webviewView: vscode.WebviewView): Promise<void> {
    try {
      const cap = await this.rpcClient.call<{
        protocol?: number | string;
        methods?: string[];
        build_fingerprint?: string;
      }>("capabilities", {});
      const rawProtocol = cap?.protocol;
      const protocol =
        typeof rawProtocol === "number"
          ? rawProtocol
          : typeof rawProtocol === "string"
            ? parseInt(rawProtocol, 10)
            : undefined;
      const methods = Array.isArray(cap?.methods) ? cap.methods : [];
      const jobProtocolOk =
        protocol === PROTOCOL_VERSION && methods.includes("job.run");
      const mismatchMessage = !jobProtocolOk
        ? protocol !== PROTOCOL_VERSION
          ? `Protocol mismatch: expected ${PROTOCOL_VERSION}, got ${rawProtocol ?? "?"}`
          : !methods.includes("job.run")
          ? "Missing method: job.run"
          : "Capabilities check failed"
        : undefined;
      webviewView.webview.postMessage({
        type: "capabilities",
        jobProtocolOk,
        protocol,
        methods,
        mismatchMessage,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.postMessage({
        type: "capabilities",
        jobProtocolOk: false,
        mismatchMessage: msg,
      });
    }
  }

  private postStatus(webviewView: vscode.WebviewView, status: AgentProcessStatus): void {
    this.configureTransport(status);
    if (status.state === "connected") {
      void this.fetchCapabilitiesAndNotify(webviewView);
    } else {
      webviewView.webview.postMessage({
        type: "capabilities",
        jobProtocolOk: false,
        mismatchMessage: "Not connected",
      });
    }
    const statusLabel =
      status.state === "connected"
        ? "connected"
        : status.state === "starting"
        ? "starting"
        : status.state === "stopping"
        ? "stopping"
        : status.state === "failed"
        ? "failed"
        : "disconnected";
    webviewView.webview.postMessage({
      type: "status",
      status: statusLabel,
      state: status.state,
      mode: status.mode,
      ownership: status.ownership,
      error: status.lastError,
      version: status.version,
      lastPingAt: status.lastPingAt,
      baseUrl: status.baseUrl,
    });
  }

  private getTranscript(): TranscriptEntry[] {
    const raw = this.workspaceState.get<TranscriptEntry[]>(TRANSCRIPT_KEY);
    return Array.isArray(raw) ? raw : [];
  }

  private async saveTranscript(entries: TranscriptEntry[]): Promise<void> {
    await this.workspaceState.update(TRANSCRIPT_KEY, entries);
  }

  private async appendToTranscript(
    role: TranscriptEntry["role"],
    text: string,
    engine?: string
  ): Promise<void> {
    const entries = this.getTranscript();
    entries.push({ role, text, ...(engine !== undefined ? { engine } : {}) });
    const trimmed = entries.slice(-MAX_TRANSCRIPT_ENTRIES);
    await this.saveTranscript(trimmed);
  }

  private async clearTranscript(): Promise<void> {
    await this.saveTranscript([]);
  }

  /** Send transcript to current view if still attached; avoids noise if webview was disposed. */
  private safeSendTranscript(): void {
    if (!this.currentView) return;
    this.currentView.webview.postMessage({ type: "transcript", payload: this.getTranscript() });
  }

  private async pingAndUpdateStatus(webviewView: vscode.WebviewView): Promise<void> {
    try {
      const ping = await this.rpcClient.call<{ ok: true; engine?: { fingerprint?: string; version?: string } }>("ping", {});
      webviewView.webview.postMessage({
        type: "status",
        status: "connected",
        version: ping?.engine?.fingerprint ?? ping?.engine?.version ?? undefined,
      });
    } catch (err: unknown) {
      webviewView.webview.postMessage({
        type: "status",
        status: "disconnected",
        error: classifyError(err),
      });
    }
  }

  private async runAction(
    webviewView: vscode.WebviewView,
    action: string,
    context?: unknown
  ): Promise<void> {
    this.out.appendLine(`[action] ${action}`);
    const confirm = (context as { confirm?: boolean })?.confirm === true;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    try {
      let jobId: string | undefined;
      try {
        const runRes = await this.rpcClient.call<{ job_id?: string }>("job.run", {
          kind: action,
          cwd: workspaceRoot,
          confirm,
        });
        jobId = runRes?.job_id;
      } catch (jobErr: unknown) {
        const isMethodNotFound =
          jobErr instanceof RpcError && (jobErr.code === "METHOD_NOT_FOUND" || jobErr.message?.includes("Unknown method"));
        if (isMethodNotFound) {
          await this.runActionLegacy(webviewView, action, context);
          return;
        }
        throw jobErr;
      }

      if (!jobId) {
        throw new Error("job.run did not return job_id");
      }

      webviewView.webview.postMessage({
        type: "job",
        phase: "started",
        action,
        jobId,
      });

      let lastLogSeq = 0;
      const terminal = new Set<JobStatus>(["success", "failed", "canceled", "aborted"]);
      for (;;) {
        const status = await this.rpcClient.call<{
          state?: string;
          summary?: string;
          report?: Record<string, unknown>;
          exit_code?: number;
        }>("job.status", { id: jobId });
        const state = status?.state ?? "unknown";

        const logsRes = await this.rpcClient.call<{ lines?: { seq: number; line: string }[]; next_seq?: number; done?: boolean }>("job.logs", {
          id: jobId,
          since_seq: lastLogSeq,
        });
        if (Array.isArray(logsRes?.lines) && logsRes.lines.length > 0) {
          const events = logsRes.lines.map(({ seq, line }) => ({
            id: seq,
            type: "step.log",
            ts_ms: Date.now(),
            payload: { text: line },
          }));
          for (const { line } of logsRes.lines) {
            this.out.appendLine(`[job] ${line}`);
          }
          webviewView.webview.postMessage({
            type: "job",
            phase: "events",
            action,
            jobId,
            events,
          });
          lastLogSeq = logsRes?.next_seq ?? lastLogSeq;
        }

        if (terminal.has(state as JobStatus)) {
          const summary = status?.summary ?? state;
          const report = status?.report ?? {};
          const protocolState = (state === "succeeded" ? "success" : state) as JobStatus;
          webviewView.webview.postMessage({
            type: "job",
            phase: "finished",
            action,
            jobId,
            status: protocolState,
            error: state === "failed" ? summary : undefined,
            result: report,
          });
          webviewView.webview.postMessage({
            type: "actionResult",
            action,
            result: report,
            jobState: state,
            summary,
          });
          this.out.appendLine(`[action] ${action} ${state}`);
          await this.appendToTranscript("system", `${action}: ${summary}`);
          this.safeSendTranscript();
          return;
        }

        await new Promise((r) => setTimeout(r, JOB_POLL_MS));
      }
    } catch (err: unknown) {
      this.out.appendLine(`[action] raw error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
      let msg = err instanceof Error ? err.message : String(err);
      if (msg === "Internal error" || msg === "Internal Error") {
        const hint = "Restart agent (run_agent.sh) and see Output → Adjutorix for details.";
        const extra = err instanceof RpcError && err.data ? ` ${JSON.stringify(err.data)}` : "";
        msg = `${hint}${extra}`;
      }
      const firstLine = msg.split(/\n/)[0]?.trim() ?? msg;
      const summary = `${action} failed · ${firstLine}`;
      webviewView.webview.postMessage({ type: "actionResult", action, error: msg });
      this.out.appendLine(`[action] ${action} failed: ${msg}`);
      await this.appendToTranscript("system", summary);
      this.safeSendTranscript();
    }
  }

  private async runActionLegacy(
    webviewView: vscode.WebviewView,
    action: string,
    context?: unknown
  ): Promise<void> {
    const confirm = (context as { confirm?: boolean })?.confirm === true;
    try {
      const env = await this.rpcClient.call<{ type: string; payload?: { action?: string; result?: any; blocked?: boolean; message?: string } }>("run", {
        job_name: "sidebar",
        action,
        confirm,
        allow_override: false,
      });
      if (!env || env.type !== "report") {
        throw new Error("Invalid run response");
      }
      const payload = env.payload || {};
      const result = payload.result;
      const report = result;
      const duration = typeof report?.duration === "number" ? report.duration : 0;
      const failedCount = report?.results?.filter((r: { return_code?: number }) => r.return_code !== 0).length ?? 0;
      const summary =
        payload.blocked
          ? `${action} blocked · ${payload.message ?? ""}`
          : report?.status === "success"
          ? `${action} OK · ${duration.toFixed(1)}s · ${failedCount} failed`
          : `${action} failed · ${(report?.message ?? "").split(/\n/)[0]?.trim() || "see logs"}`;
      webviewView.webview.postMessage({ type: "actionResult", action, result: report });
      this.out.appendLine(`[action] ${action} ${report?.status === "success" ? "ok" : "failed"}`);
      await this.appendToTranscript("system", summary);
      this.safeSendTranscript();
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : String(err);
      const firstLine = msg.split(/\n/)[0]?.trim() ?? msg;
      await this.appendToTranscript("system", `${action} failed · ${firstLine}`);
      this.safeSendTranscript();
    }
  }

  private async handlePatchGet(webviewView: vscode.WebviewView, patchId: string): Promise<void> {
    try {
      const res = await this.rpcClient.call<{
        patch_id?: string;
        patch_format?: string;
        patch_text?: string;
        summary?: string;
        status?: string;
        base_rev?: string;
        review_ops?: Array<{
          path: string;
          op: string;
          new_content_b64?: string;
          base_content_b64?: string;
          base_mismatch: boolean;
        }>;
      }>("patch.get", { patch_id: patchId, include_review: true });
      webviewView.webview.postMessage({
        type: "patchGetResult",
        patch_id: patchId,
        patch_format: res?.patch_format,
        patch_text: res?.patch_text ?? "",
        summary: res?.summary ?? "",
        status: res?.status,
        base_rev: res?.base_rev,
        review_ops: res?.review_ops ?? undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.postMessage({
        type: "patchGetResult",
        patch_id: patchId,
        error: msg,
      });
    }
  }

  private async handlePatchList(webviewView: vscode.WebviewView): Promise<void> {
    try {
      const res = await this.rpcClient.call<{ patches?: Array<{ patch_id: string; job_id: string; status: string; created_at_ms: number; summary: string }> }>("patch.list", { limit: 50 });
      webviewView.webview.postMessage({ type: "patchListResult", patches: res?.patches ?? [] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.postMessage({ type: "patchListResult", patches: [], error: msg });
    }
  }

  private async handlePatchAccept(webviewView: vscode.WebviewView, patchId: string): Promise<void> {
    try {
      const res = await this.rpcClient.call<{ ok?: boolean }>("patch.accept", { patch_id: patchId });
      webviewView.webview.postMessage({ type: "patchActionResult", patch_id: patchId, action: "accept", ok: res?.ok ?? false });
      await this.handlePatchList(webviewView);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.postMessage({ type: "patchActionResult", patch_id: patchId, action: "accept", ok: false, error: msg });
    }
  }

  private async handlePatchReject(webviewView: vscode.WebviewView, patchId: string): Promise<void> {
    try {
      const res = await this.rpcClient.call<{ ok?: boolean }>("patch.reject", { patch_id: patchId });
      webviewView.webview.postMessage({ type: "patchActionResult", patch_id: patchId, action: "reject", ok: res?.ok ?? false });
      await this.handlePatchList(webviewView);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.postMessage({ type: "patchActionResult", patch_id: patchId, action: "reject", ok: false, error: msg });
    }
  }

  private async handlePatchApply(webviewView: vscode.WebviewView, patchId: string): Promise<void> {
    try {
      const res = await this.rpcClient.call<{ ok?: boolean; error?: string; conflict_files?: string[] }>("patch.apply", { patch_id: patchId });
      webviewView.webview.postMessage({
        type: "patchActionResult",
        patch_id: patchId,
        action: "apply",
        ok: res?.ok ?? false,
        error: res?.error,
        conflict_files: res?.conflict_files,
      });
      await this.handlePatchList(webviewView);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.postMessage({ type: "patchActionResult", patch_id: patchId, action: "apply", ok: false, error: msg });
    }
  }

  private async runChat(
    webviewView: vscode.WebviewView,
    payload: { message: string; context?: unknown }
  ): Promise<void> {
    const { message } = payload;
    const raw = message.trim();
    this.out.appendLine(`[chat] ${raw.slice(0, 80)}…`);
    await this.appendToTranscript("user", message);
    this.safeSendTranscript();

    // Slash commands: route to RPC or actions (controller UX)
    const cmd = raw.startsWith("/") ? raw.slice(1).split(/\s+/)[0] : null;
    if (cmd) {
      const map: Record<string, string> = {
        check: "check",
        fix: "fix",
        verify: "verify",
        deploy: "deploy",
        status: "status",
        cap: "capabilities",
      };
      const m = map[cmd];
      if (!m) {
        const msg = `Unknown command: /${cmd} (try /cap)`;
        await this.appendToTranscript("assistant", msg);
        this.safeSendTranscript();
        return;
      }
      if (m === "status" || m === "capabilities") {
        try {
          const res = await this.rpcClient.call<unknown>(m, {});
          await this.appendToTranscript("assistant", JSON.stringify(res, null, 2));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          await this.appendToTranscript("assistant", `Error: ${msg}`);
        }
        this.safeSendTranscript();
        return;
      }
      await this.runAction(webviewView, m, { confirm: m === "deploy" });
      return;
    }

    try {
      const transcript = this.getTranscript()
        .filter((e) => e.role === "user" || e.role === "assistant")
        .slice(-20)
        .map((e) => ({ role: e.role, content: e.text }));
      const env = await this.rpcClient.call<ChatEnvelope>("chat", { messages: transcript });
      if (!env || typeof env !== "object") {
        this.out.appendLine("[chat] invalid envelope (not object)");
        await this.appendToTranscript("assistant", "Invalid response (no envelope).");
        this.safeSendTranscript();
        return;
      }
      if (env.type === "reject") {
        await this.appendToTranscript("assistant", formatEnvelope(env));
        this.safeSendTranscript();
        return;
      }
      await this.appendToTranscript("assistant", formatEnvelope(env));
      this.safeSendTranscript();
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : String(err);
      if (msg === "Internal error" || msg === "Internal Error") {
        const hint = "Restart agent (run_agent.sh) and see Output → Adjutorix for details.";
        const extra = err instanceof RpcError && err.data ? ` ${JSON.stringify(err.data)}` : "";
        msg = `${hint}${extra}`;
      }
      const firstLine = msg.split(/\n/)[0]?.trim() ?? msg;
      webviewView.webview.postMessage({ type: "chatResult", error: msg });
      this.out.appendLine(`[chat] failed: ${firstLine}`);
      await this.appendToTranscript("assistant", `Error: ${firstLine}`, "error");
      this.safeSendTranscript();
    }
  }

  private getHtml(webview: vscode.Webview, uiSession: string): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Adjutorix</title>
  <style>
    :root { --r: 12px; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 10px; margin: 0; color: var(--vscode-foreground); }
    * { box-sizing: border-box; }

    .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .status { display:inline-block; padding:2px 8px; border-radius: 6px; font-size: 12px; margin-bottom: 8px; }
    .status.connected { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoBorder); }
    .status.starting, .status.stopping { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
    .status.failed, .status.disconnected { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorBorder); }
    .status-detail { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 0 0 10px; }

    .indicators { display: flex; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
    .indicator { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
    .indicator .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-inputValidation-errorBackground); }
    .indicator.green .dot { background: #16825d; box-shadow: 0 0 6px rgba(22,130,93,0.6); }
    .indicator.green { color: #16825d; }
    .indicator:not(.green) { color: var(--vscode-descriptionForeground); }

    .mode-selector { display:flex; border: 1px solid var(--vscode-input-border); border-radius: 8px; overflow:hidden; margin-bottom: 10px; }
    .mode-selector button { flex:1; padding: 6px 8px; border:none; background: var(--vscode-input-background); color: var(--vscode-foreground); font-size: 11px; cursor: pointer; }
    .mode-selector button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .mode-selector button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .controller-banner { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    .managed-failure-banner { font-size: 11px; color: var(--vscode-inputValidation-errorBorder); margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }

    .transcript-wrap { margin-bottom: 10px; }
    .transcript { min-height: 72px; max-height: 200px; overflow:auto; border: 1px solid var(--vscode-input-border); border-radius: var(--r); padding: 8px; background: var(--vscode-input-background); font-size: 12px; }
    .transcript-entry { margin: 6px 0; white-space: pre-wrap; word-break: break-word; }
    .transcript-entry.user { color: var(--vscode-textLink-foreground); }
    .transcript-entry.assistant { color: var(--vscode-foreground); }
    .transcript-entry.system { color: var(--vscode-descriptionForeground); font-style: italic; }
    .clear-btn { margin-top: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; }

    /* --- SURFACE COMPOSER --- */
    .composer { border: 1px solid var(--vscode-input-border); border-radius: 14px; background: var(--vscode-input-background); overflow:hidden; margin-bottom: 8px; }
    .composer textarea {
      width: 100%;
      min-height: 72px;
      padding: 10px 12px;
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      color: var(--vscode-foreground);
      font: inherit;
    }
    .composer textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .composer-footer {
      display:flex;
      align-items:center;
      justify-content: space-between;
      padding: 6px 10px;
      border-top: 1px solid var(--vscode-input-border);
    }
    .composer-left { display:flex; align-items:center; gap: 8px; }
    .icon-btn {
      border:none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 12px;
    }
    .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .mode-pill { display:flex; align-items:center; gap: 6px; }

    .context-line { display:flex; align-items:center; gap: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); margin: 4px 0 10px; }
    .context-line .pill { padding: 2px 8px; border: 1px solid var(--vscode-input-border); border-radius: 999px; }

    .actions { display:flex; flex-wrap: wrap; gap: 6px; }
    .actions button { padding: 6px 10px; font-size: 12px; cursor:pointer; }
    .actions button:disabled { opacity: .6; cursor:not-allowed; }
  </style>
</head>
<body>
  <div style="font-weight:700; font-size:12px; opacity:.8; margin-bottom:8px;">ADJUTORIX SURFACE v2</div>
  <div class="indicators">
    <div id="indicatorSystem" class="indicator green"><span class="dot"></span><span>System</span></div>
    <div id="indicatorEngine" class="indicator"><span class="dot"></span><span>Engine</span></div>
    <div id="indicatorChat" class="indicator"><span class="dot"></span><span>Chat</span></div>
  </div>
  <div id="status" class="status disconnected">Checking…</div>
  <div id="statusDetail" class="status-detail"></div>
  <div id="controllerBanner" class="controller-banner" style="display:none;"></div>
  <div id="managedFailureBanner" class="managed-failure-banner" style="display:none;"></div>

  <div class="mode-selector" id="modeSelector">
    <button type="button" data-mode="auto">Auto</button>
    <button type="button" data-mode="managed">Managed</button>
    <button type="button" data-mode="external">External</button>
  </div>

  <div class="transcript-wrap">
    <div class="transcript" id="transcript"></div>
    <button id="clearTranscript" class="clear-btn">Clear</button>
  </div>

  <div class="composer">
    <textarea id="composerInput" placeholder="Plan, @ for context, / for commands" rows="3"></textarea>
    <div class="composer-footer">
      <div class="composer-left">
        <button type="button" id="composerAttach" class="icon-btn" title="Attach">∞</button>
        <button type="button" id="composerMode" class="icon-btn mode-pill" title="Mode">
          <span id="composerModeLabel">Auto</span><span>▾</span>
        </button>
      </div>
      <button type="button" id="composerMic" class="icon-btn" title="Voice">🎙</button>
    </div>
  </div>

  <div class="context-line">
    <span class="pill" id="contextLabel">Local</span><span>▾</span>
  </div>

  <div class="actions">
    <button data-action="check">Check</button>
    <button data-action="fix">Fix</button>
    <button data-action="verify">Verify</button>
    <button data-action="deploy">Deploy</button>
  </div>

  <div class="patches-section" style="margin-top:12px;">
    <div style="font-weight:600; font-size:11px; margin-bottom:6px;">Diff (Patches)</div>
    <button type="button" id="refreshPatches" class="icon-btn" style="margin-bottom:6px;">Refresh</button>
    <div id="patchList" style="font-size:11px;"></div>
    <div id="patchDiffView" style="display:none; margin-top:8px; border:1px solid var(--vscode-input-border); border-radius:4px; padding:8px; max-height:200px; overflow:auto;">
      <div style="font-weight:600; font-size:11px; margin-bottom:4px;">Review</div>
      <pre id="patchDiffContent" style="font-size:10px; white-space:pre-wrap; word-break:break-all; margin:0;"></pre>
      <button type="button" id="patchDiffClose" class="icon-btn" style="margin-top:4px;">Close</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'log', payload: 'ui_session=' + ${JSON.stringify(uiSession)} });

    const statusEl = document.getElementById('status');
    const statusDetailEl = document.getElementById('statusDetail');
    const transcriptEl = document.getElementById('transcript');
    const modeSelectorEl = document.getElementById('modeSelector');
    const composerInput = document.getElementById('composerInput');
    const composerModeLabel = document.getElementById('composerModeLabel');
    const actionBtns = document.querySelectorAll('.actions button');
    const controllerBannerEl = document.getElementById('controllerBanner');
    const managedFailureBannerEl = document.getElementById('managedFailureBanner');

    let connected = false;
    let currentMode = 'auto';
    let controllerMode = false;
    let jobProtocolOk = true;
    let activeJob = null;

    function jobLine(s) {
      const el = document.createElement('div');
      el.className = 'transcript-entry system';
      el.textContent = 'System: ' + s;
      transcriptEl.appendChild(el);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function applyActionEnablement() {
      actionBtns.forEach(b => {
        const a = b.dataset.action;
        if (!jobProtocolOk || !connected) { b.disabled = true; return; }
        if (a === 'deploy') { b.disabled = (currentMode !== 'managed'); return; }
        b.disabled = false;
      });
    }

    function setConnected(c) {
      connected = c;
      composerInput.disabled = !c;
      updateComposerPlaceholder();
      applyActionEnablement();
    }

    function updateComposerPlaceholder() {
      if (!jobProtocolOk) {
        composerInput.placeholder = 'Controller disabled. Fix protocol or agent; see banner.';
        return;
      }
      if (controllerMode) {
        composerInput.placeholder = 'Use Check/Fix/Verify. Chat won\\'t execute tools.';
        return;
      }
      composerInput.placeholder = 'Plan, @ for context, / for commands';
    }

    function setModeActive(mode) {
      currentMode = mode;
      modeSelectorEl.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      composerModeLabel.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      applyActionEnablement();
    }

    modeSelectorEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        vscode.postMessage({ type: 'setMode', payload: { mode } });
      });
    });

    function formatDetail(m) {
      const parts = [];
      if (m.mode) parts.push('Mode: ' + (m.mode.charAt(0).toUpperCase() + m.mode.slice(1)));
      if (m.ownership) parts.push('Ownership: ' + (m.ownership === 'unknown' ? 'Unknown' : m.ownership.charAt(0).toUpperCase() + m.ownership.slice(1)));
      if (m.baseUrl && (m.status === 'connected' || m.status === 'failed')) parts.push('Endpoint: ' + m.baseUrl);
      if (m.version) parts.push('v' + m.version);
      if (m.error) parts.push(m.error);
      return parts.join(' · ');
    }

    function setTranscript(entries) {
      transcriptEl.innerHTML = '';
      (entries || []).forEach(entry => {
        const el = document.createElement('div');
        el.className = 'transcript-entry ' + entry.role;
        const prefix = entry.role === 'user' ? 'You: ' : entry.role === 'assistant' ? 'Adjutorix: ' : 'System: ';
        el.textContent = prefix + entry.text;
        transcriptEl.appendChild(el);
      });
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function setIndicators(engineGreen, chatGreen) {
      document.getElementById('indicatorSystem').classList.toggle('green', true);
      document.getElementById('indicatorEngine').classList.toggle('green', engineGreen);
      document.getElementById('indicatorChat').classList.toggle('green', chatGreen);
    }

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'job') {
        if (m.phase === 'started') {
          activeJob = { jobId: m.jobId, action: m.action };
          jobLine('[' + m.action + '] started (job ' + m.jobId + ')');
          return;
        }
        if (m.phase === 'events') {
          const events = Array.isArray(m.events) ? m.events : [];
          for (const ev of events) {
            const t = ev && typeof ev === 'object' ? (ev.type || 'event') : 'event';
            const p = ev && typeof ev === 'object' ? ev.payload : undefined;
            const msg = p && typeof p === 'object' && typeof p.text === 'string' ? p.text :
              p && typeof p === 'object' && typeof p.message === 'string' ? p.message :
              p && typeof p === 'string' ? p : p != null ? JSON.stringify(p) : '';
            jobLine('[' + m.action + '] ' + t + (msg ? ' · ' + msg : ''));
          }
          return;
        }
        if (m.phase === 'finished') {
          const st = m.status || 'failed';
          const err = m.error ? (' · ' + m.error) : '';
          jobLine('[' + m.action + '] ' + st + ' (job ' + m.jobId + ')' + err);
          activeJob = null;
          return;
        }
        return;
      }
      if (m.type === 'status') {
        const s = m.status;
        statusEl.textContent =
          s === 'connected' ? 'Connected' :
          s === 'starting' ? 'Starting…' :
          s === 'stopping' ? 'Stopping…' :
          s === 'failed' ? 'Failed' : 'Disconnected';
        statusEl.className = 'status ' + s;
        setConnected(s === 'connected');
        setIndicators(s === 'connected', s === 'connected');
        if (m.mode) setModeActive(m.mode);
        statusDetailEl.textContent = formatDetail(m);
        controllerMode = (m.version === 'reject_only_v2');
        if (controllerBannerEl) {
          if (controllerMode) {
            controllerBannerEl.textContent = 'Controller mode: use Check/Fix/Verify; chat is advisory only.';
            controllerBannerEl.style.display = 'block';
          } else {
            controllerBannerEl.style.display = 'none';
          }
        }
        if (managedFailureBannerEl) {
          const showManagedWarning =
            (m.mode === 'managed' && m.ownership !== 'managed') ||
            (m.error && String(m.error).includes('Managed requires extension-spawned'));
          if (showManagedWarning) {
            managedFailureBannerEl.textContent = 'Managed requires extension-spawned agent; stop external agent or switch to Auto.';
            managedFailureBannerEl.style.display = 'block';
          } else {
            managedFailureBannerEl.style.display = 'none';
          }
        }
        updateComposerPlaceholder();
      } else if (m.type === 'capabilities') {
        jobProtocolOk = m.jobProtocolOk === true;
        if (controllerBannerEl) {
          if (!jobProtocolOk && m.mismatchMessage) {
            controllerBannerEl.textContent = 'Controller disabled: ' + m.mismatchMessage;
            controllerBannerEl.style.display = 'block';
          } else if (controllerMode) {
            controllerBannerEl.textContent = 'Controller mode: use Check/Fix/Verify; chat is advisory only.';
            controllerBannerEl.style.display = 'block';
          } else if (!jobProtocolOk) {
            controllerBannerEl.textContent = 'Controller disabled: protocol or job.run not available.';
            controllerBannerEl.style.display = 'block';
          } else {
            controllerBannerEl.style.display = 'none';
          }
        }
        updateComposerPlaceholder();
        applyActionEnablement();
      } else if (m.type === 'transcript') {
        setTranscript(m.payload || []);
      }
    });

    // Send chat on Enter; require controller enabled (jobProtocolOk) so we don't spam when disabled
    composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const msg = composerInput.value.trim();
        if (!msg || !connected || !jobProtocolOk) return;
        if (controllerMode && !msg.startsWith('/')) return;
        composerInput.value = '';
        vscode.postMessage({ type: 'chat', payload: { message: msg } });
      }
    });

    // Actions (Managed mode only); deploy requires confirm
    document.querySelectorAll('.actions button').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        const action = b.dataset.action || 'check';
        if (action === 'deploy') {
          const ok = confirm('Deploy is blocked by default. Proceed?');
          if (!ok) return;
          vscode.postMessage({ type: 'action', payload: { action: 'deploy', confirm: true } });
          return;
        }
        vscode.postMessage({ type: 'action', payload: { action, confirm: false } });
      });
    });

    document.getElementById('composerAttach').addEventListener('click', () => {});
    document.getElementById('composerMic').addEventListener('click', () => {});
    document.getElementById('composerMode').addEventListener('click', () => {});

    document.getElementById('clearTranscript').addEventListener('click', () => {
      vscode.postMessage({ type: 'clearTranscript' });
    });

    vscode.postMessage({ type: 'ready' });
    vscode.postMessage({ type: 'patchList' });
    document.getElementById('refreshPatches').addEventListener('click', () => { vscode.postMessage({ type: 'patchList' }); });

    function renderPatches(patches, err) {
      const el = document.getElementById('patchList');
      if (err) { el.innerHTML = '<div style="color:var(--vscode-errorForeground);">' + err + '</div>'; return; }
      if (!patches || patches.length === 0) { el.innerHTML = '<div class="description">No patches.</div>'; return; }
      el.innerHTML = patches.map(p => {
        const id = p.patch_id || '';
        const summary = (p.summary || '').slice(0, 60);
        const status = p.status || '?';
        let btns = '<button type="button" class="icon-btn patch-review" data-patch-id="' + id + '">Review</button>';
        if (status === 'proposed') btns += '<button type="button" class="icon-btn patch-accept" data-patch-id="' + id + '">Accept</button><button type="button" class="icon-btn patch-reject" data-patch-id="' + id + '">Reject</button>';
        else if (status === 'accepted') btns += '<button type="button" class="icon-btn patch-apply" data-patch-id="' + id + '">Apply</button>';
        return '<div class="patch-item" style="margin:4px 0; padding:4px; border:1px solid var(--vscode-input-border); border-radius:4px;">' +
          '<span>' + (id ? id.slice(0,8) : '?') + '</span> ' + status + ' · ' + summary + ' ' + btns + '</div>';
      }).join('');
      el.querySelectorAll('.patch-review').forEach(b => b.addEventListener('click', () => { vscode.postMessage({ type: 'patchGet', payload: { patch_id: b.dataset.patchId } }); }));
      el.querySelectorAll('.patch-accept').forEach(b => b.addEventListener('click', () => { vscode.postMessage({ type: 'patchAccept', payload: { patch_id: b.dataset.patchId } }); }));
      el.querySelectorAll('.patch-reject').forEach(b => b.addEventListener('click', () => { vscode.postMessage({ type: 'patchReject', payload: { patch_id: b.dataset.patchId } }); }));
      el.querySelectorAll('.patch-apply').forEach(b => b.addEventListener('click', () => { vscode.postMessage({ type: 'patchApply', payload: { patch_id: b.dataset.patchId } }); }));
    }

    document.getElementById('patchDiffClose').addEventListener('click', () => {
      document.getElementById('patchDiffView').style.display = 'none';
    });

    function b64ToUtf8(b64) {
      try {
        const bin = atob(b64 || '');
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) { return null; }
    }
    function simpleUnifiedDiff(path, oldStr, newStr) {
      const ol = (oldStr || '').split(/\\r?\\n/);
      const nl = (newStr || '').split(/\\r?\\n/);
      let i = 0;
      while (i < ol.length && i < nl.length && ol[i] === nl[i]) i++;
      let jo = ol.length, jn = nl.length;
      while (jo > i && jn > i && ol[jo - 1] === nl[jn - 1]) { jo--; jn--; }
      let out = '--- a/' + path + '\\n+++ b/' + path + '\\n';
      for (let k = 0; k < i; k++) out += '  ' + ol[k] + '\\n';
      for (let k = i; k < jo; k++) out += '- ' + ol[k] + '\\n';
      for (let k = i; k < jn; k++) out += '+ ' + nl[k] + '\\n';
      for (let k = jn; k < nl.length; k++) out += '  ' + nl[k] + '\\n';
      return out;
    }
    function renderDiff(payload) {
      const view = document.getElementById('patchDiffView');
      const pre = document.getElementById('patchDiffContent');
      if (payload.error) {
        pre.textContent = 'Error: ' + payload.error;
      } else if (payload.patch_format === 'file_ops' && Array.isArray(payload.review_ops) && payload.review_ops.length > 0) {
        const parts = [payload.summary ? payload.summary + '\n\n' : ''];
        for (const ro of payload.review_ops) {
          const path = ro.path || '?';
          parts.push('=== ' + ro.op + ' ' + path + ' ===');
          if (ro.base_mismatch) {
            parts.push('[base mismatch; diff unreliable]');
            continue;
          }
          if (ro.op === 'write') {
            const newStr = b64ToUtf8(ro.new_content_b64);
            const baseStr = b64ToUtf8(ro.base_content_b64 || '');
            if (newStr === null || (ro.base_content_b64 && baseStr === null)) {
              parts.push('[binary changed]');
            } else if (!ro.base_content_b64 || ro.base_content_b64.length === 0) {
              parts.push('+ new file');
              parts.push((newStr || '').slice(0, 2000) + (newStr && newStr.length > 2000 ? '...' : ''));
            } else {
              parts.push(simpleUnifiedDiff(path, baseStr, newStr));
            }
          } else if (ro.op === 'delete') {
            parts.push('file deleted');
            const baseStr = b64ToUtf8(ro.base_content_b64 || '');
            if (baseStr !== null && baseStr.length > 0)
              parts.push((baseStr || '').slice(0, 800) + (baseStr.length > 800 ? '...' : ''));
          }
          parts.push('');
        }
        pre.textContent = parts.join('\n');
      } else if (payload.patch_format === 'file_ops') {
        try {
          const ops = JSON.parse(payload.patch_text || '[]');
          const lines = (ops || []).map((o, i) => {
            const path = o.path || o.from || '?';
            const op = o.op || '?';
            let extra = '';
            if (o.new_content_b64) extra = ' (+' + (o.new_content_b64.length) + ' b64)';
            if (o.base_sha) extra += ' base=' + (o.base_sha === '0'.repeat(64) ? 'empty' : String(o.base_sha).slice(0,8));
            return (i+1) + '. ' + op + ' ' + path + extra;
          });
          pre.textContent = (payload.summary ? payload.summary + '\n\n' : '') + lines.join('\n');
        } catch (e) {
          pre.textContent = payload.patch_text ? payload.patch_text.slice(0, 2000) : 'No content';
        }
      } else {
        pre.textContent = (payload.summary ? payload.summary + '\n\n' : '') + (payload.patch_text || '');
      }
      view.style.display = 'block';
    }

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'patchListResult') {
        renderPatches(m.patches, m.error);
        return;
      }
      if (m.type === 'patchGetResult') {
        renderDiff(m);
        return;
      }
      if (m.type === 'patchActionResult' && m.error) {
        const el = document.getElementById('patchList');
        const prev = el.innerHTML;
        el.innerHTML = '<div style="color:var(--vscode-errorForeground); margin-bottom:6px;">' + m.action + ': ' + m.error + '</div>' + prev;
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
