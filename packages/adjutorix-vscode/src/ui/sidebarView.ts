import * as vscode from "vscode";
import { RpcClient } from "../client/rpc";
import { RpcError } from "../client/types";
import { Settings } from "../config/settings";
import type { AgentProcessManager, AgentProcessStatus } from "../agent/processManager";
import { classifyError } from "../agent/processManager";

const PING_INTERVAL_MS = 3_000;
const PING_BACKOFF_INITIAL_MS = 2_000;
const PING_BACKOFF_MAX_MS = 30_000;
const TRANSCRIPT_KEY = "adjutorix.transcript";
const MAX_TRANSCRIPT_ENTRIES = 100;

export interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  text: string;
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
    webviewView.onDidDispose(() => {
      this.out.appendLine("[view] disposed");
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
    webviewView.webview.html = this.getHtml(webviewView.webview);

    if (this.agentProcessManager) {
      const pushStatus = (status: AgentProcessStatus) => {
        this.postStatus(webviewView, status);
      };
      pushStatus(this.agentProcessManager.getStatus());
      this.statusSubscription = this.agentProcessManager.onStatusChange(pushStatus);

      const settings = Settings.get();
      if (settings.autoStartAgent) {
        const st = this.agentProcessManager.getStatus();
        if (st.state === "stopped" || st.state === "failed") {
          this.agentProcessManager.start().catch((e) => {
            this.out.appendLine(`[view] autoStart failed: ${e}`);
          });
        }
      }

      this.schedulePing(webviewView);
    } else {
      this.pingAndUpdateStatus(webviewView);
    }

    webviewView.webview.onDidReceiveMessage(async (msg: { type: string; payload?: unknown }) => {
      this.out.appendLine(`[view] msg: ${JSON.stringify(msg)}`);
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
        case "action":
          await this.runAction(webviewView, msg.payload as string, undefined);
          break;
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
        case "setMode": {
          const mode = (msg.payload as string) as "auto" | "managed" | "external";
          if (mode !== "auto" && mode !== "managed" && mode !== "external") break;
          void Settings.set("agentMode", mode);
          if (this.agentProcessManager) {
            this.agentProcessManager.setMode(mode);
            this.postStatus(webviewView, this.agentProcessManager.getStatus());
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
      if (ok) {
        this.pingBackoffMs = PING_INTERVAL_MS;
      } else {
        this.pingBackoffMs = Math.min(
          this.pingBackoffMs * 2 || PING_BACKOFF_INITIAL_MS,
          PING_BACKOFF_MAX_MS
        );
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

  private postStatus(webviewView: vscode.WebviewView, status: AgentProcessStatus): void {
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

  private async appendToTranscript(role: TranscriptEntry["role"], text: string): Promise<void> {
    const entries = this.getTranscript();
    entries.push({ role, text });
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
      await this.rpcClient.call("ping", {});
      webviewView.webview.postMessage({
        type: "status",
        status: "connected",
        version: undefined,
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
    try {
      const res = await this.rpcClient.call<{ ok: boolean; result?: { status?: string; duration?: number; results?: { return_code?: number }[]; message?: string } }>("run", {
        job_name: "sidebar",
        action,
        allow_override: false,
        ...(context ? { context } : {}),
      });
      const report = res?.result;
      const duration = typeof report?.duration === "number" ? report.duration : 0;
      const failedCount = report?.results?.filter((r) => r.return_code !== 0).length ?? 0;
      const summary =
        report?.status === "success"
          ? `${action} OK · ${duration.toFixed(1)}s · ${failedCount} failed`
          : `${action} failed · ${(report?.message ?? "").split(/\n/)[0]?.trim() || "see logs"}`;
      webviewView.webview.postMessage({ type: "actionResult", action, result: report });
      this.out.appendLine(`[action] ${action} ${report?.status === "success" ? "ok" : "failed"}`);
      await this.appendToTranscript("system", summary);
      this.safeSendTranscript();
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

  private async runChat(
    webviewView: vscode.WebviewView,
    payload: { message: string; context?: unknown }
  ): Promise<void> {
    const { message, context } = payload;
    this.out.appendLine(`[chat] ${message.slice(0, 80)}…`);
    await this.appendToTranscript("user", message);
    this.safeSendTranscript();
    try {
      const result = await this.rpcClient.call("run", {
        job_name: "sidebar",
        action: "chat",
        allow_override: false,
        message,
        ...(context ? { context } : {}),
      });
      const assistantText =
        typeof result === "string"
          ? result
          : (result as { message?: string; text?: string })?.message ??
            (result as { message?: string; text?: string })?.text ??
            JSON.stringify(result);
      webviewView.webview.postMessage({ type: "chatResult", result });
      this.out.appendLine("[chat] ok");
      await this.appendToTranscript("assistant", assistantText);
      this.safeSendTranscript();
    } catch (err: unknown) {
      this.out.appendLine(`[chat] raw error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
      let msg = err instanceof Error ? err.message : String(err);
      if (msg === "Internal error" || msg === "Internal Error") {
        const hint = "Restart agent (run_agent.sh) and see Output → Adjutorix for details.";
        const extra = err instanceof RpcError && err.data ? ` ${JSON.stringify(err.data)}` : "";
        msg = `${hint}${extra}`;
      }
      const firstLine = msg.split(/\n/)[0]?.trim() ?? msg;
      webviewView.webview.postMessage({ type: "chatResult", error: msg });
      this.out.appendLine(`[chat] failed: ${msg}`);
      await this.appendToTranscript("assistant", `Error: ${firstLine}`);
      this.safeSendTranscript();
    }
  }

  private getHtml(webview: vscode.Webview): string {
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
    .mode-selector button { flex:1; padding: 6px 8px; border:none; background: var(--vscode-input-background); color: var(--vscode-foreground); cursor:pointer; font-size: 11px; }
    .mode-selector button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

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

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const statusEl = document.getElementById('status');
    const statusDetailEl = document.getElementById('statusDetail');
    const transcriptEl = document.getElementById('transcript');
    const modeSelectorEl = document.getElementById('modeSelector');
    const composerInput = document.getElementById('composerInput');
    const composerModeLabel = document.getElementById('composerModeLabel');
    const actionBtns = document.querySelectorAll('.actions button');

    let connected = false;
    let currentMode = 'auto';

    function setConnected(c) {
      connected = c;
      actionBtns.forEach(b => b.disabled = !c);
      composerInput.disabled = !c;
    }

    function setModeActive(mode) {
      currentMode = mode;
      modeSelectorEl.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      composerModeLabel.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    }

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
        const prefix = entry.role === 'user' ? 'You: ' : entry.role === 'assistant' ? 'Agent: ' : 'System: ';
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
      } else if (m.type === 'transcript') {
        setTranscript(m.payload || []);
      }
    });

    // Send chat on Enter (like the screenshot UX)
    composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const msg = composerInput.value.trim();
        if (!msg || !connected) return;
        composerInput.value = '';
        vscode.postMessage({ type: 'chat', payload: { message: msg } });
      }
    });

    // Actions
    document.querySelectorAll('.actions button').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        vscode.postMessage({ type: 'action', payload: b.dataset.action });
      });
    });

    // Mode selector
    modeSelectorEl.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const mode = b.dataset.mode;
        if (!mode) return;
        setModeActive(mode);
        vscode.postMessage({ type: 'setMode', payload: mode });
      });
    });

    // Cosmetic buttons (no-op for now)
    document.getElementById('composerAttach').addEventListener('click', () => {});
    document.getElementById('composerMic').addEventListener('click', () => {});
    document.getElementById('composerMode').addEventListener('click', () => {
      // cycles modes for quick UX
      const order = ['auto','managed','external'];
      const next = order[(order.indexOf(currentMode) + 1) % order.length];
      modeSelectorEl.querySelector(\`button[data-mode="\${next}"]\`).click();
    });

    document.getElementById('clearTranscript').addEventListener('click', () => {
      vscode.postMessage({ type: 'clearTranscript' });
    });

    vscode.postMessage({ type: 'ready' });
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
