import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { RpcClient } from "./client/rpc";
import { Settings } from "./config/settings";
import { AdjutorixPanel } from "./ui/panel";
import { AgentCommands } from "./ui/commands";
import { AgentState } from "./ui/state";
import { AdjutorixViewProvider } from "./ui/sidebarView";
import { AgentProcessManager } from "./agent/processManager";
import { buildDiagnosticsReport, formatDiagnosticsReport } from "./diagnostics/report";

let rpcClient: RpcClient | null = null;
let agentProcessManager: AgentProcessManager | null = null;

/**
 * Extension entry point. Runs in VS Code and Cursor.
 */
export async function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Adjutorix");
  context.subscriptions.push({ dispose: () => out.dispose() });

  out.appendLine("Adjutorix activated.");
  out.show(true);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // When no folder is open, auto-open adjutorix.workspacePath so the agent can start (force fix for "Open a folder").
  if (!workspaceRoot) {
    const fallbackPath = Settings.getWorkspacePath();
    if (fallbackPath) {
      const resolved = path.isAbsolute(fallbackPath) ? fallbackPath : path.resolve(process.env.HOME || "", fallbackPath);
      if (fs.existsSync(resolved)) {
        out.appendLine(`[extension] No workspace folder; opening adjutorix.workspacePath: ${resolved}`);
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(resolved));
        return;
      }
    }
    out.appendLine("→ Open a folder (File → Open Folder) or run 'Adjutorix: Open Workspace Folder' so the agent can start.");
    out.appendLine("→ Click the ADJUTORIX icon in the left sidebar, or run: Adjutorix: Show Sidebar");
  }

  const endpoint = Settings.getAgentEndpoint();
  rpcClient = new RpcClient(`${endpoint}/rpc`);
  const state = new AgentState();

  if (workspaceRoot) {
    const initialMode = Settings.get().agentMode;
    agentProcessManager = new AgentProcessManager({
      baseUrl: endpoint,
      workspaceRoot,
      out,
      initialMode,
    });
    context.subscriptions.push({
      dispose: () => {
        if (agentProcessManager) {
          agentProcessManager.stop();
          agentProcessManager = null;
        }
      },
    });
  } else {
    out.appendLine("[extension] No workspace folder; agent process manager not created.");
  }

  const extensionVersion = context.extension.packageJSON?.version ?? "0.0.0";

  // Sidebar: Chat + Actions webview (replaces placeholder tree)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "adjutorix.surface",
      new AdjutorixViewProvider(
        context.extensionUri,
        rpcClient,
        out,
        agentProcessManager,
        context.workspaceState
      ),
      { webviewOptions: { retainContextWhenHidden: false } }
    )
  );

  // Smoke test
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.smoke", async () => {
      out.show(true);
      out.appendLine("smoke()");
      vscode.window.showInformationMessage("Adjutorix smoke OK");
    })
  );

  // Prove which extension instance is running (no guessing)
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.whereAmI", async () => {
      out.show(true);
      out.appendLine(`[whereAmI] ${context.extensionPath}`);
      vscode.window.showInformationMessage(`Adjutorix running from: ${context.extensionPath}`);
    })
  );

  // Reveal sidebar view (removes "where is it?" ambiguity)
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.showSidebar", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.adjutorix");
      await vscode.commands.executeCommand("adjutorix.surface.focus");
    })
  );

  // Open a folder so the agent can start (fixes "no workspace" state).
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.openWorkspaceFolder", async () => {
      const uri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        title: "Select folder for Adjutorix agent (e.g. your ADJUTORIX repo)",
      });
      if (uri?.[0]) {
        await vscode.commands.executeCommand("vscode.openFolder", uri[0]);
        out.appendLine(`[extension] Opening workspace folder: ${uri[0].fsPath}`);
      }
    })
  );

  // adjutorix.open → full panel (editor area)
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.open", () => {
      AdjutorixPanel.createOrShow(context.extensionUri);
    })
  );

  // Agent lifecycle
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.startAgent", async () => {
      if (!agentProcessManager) {
        vscode.window.showWarningMessage("No workspace opened; cannot start agent.");
        return;
      }
      out.show(true);
      try {
        await agentProcessManager.start();
        vscode.window.showInformationMessage("Adjutorix agent started.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to start agent: ${msg}`);
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.stopAgent", () => {
      if (agentProcessManager) {
        agentProcessManager.stop();
        vscode.window.showInformationMessage("Adjutorix agent stopped.");
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.restartAgent", async () => {
      if (!agentProcessManager) {
        vscode.window.showWarningMessage("No workspace opened; cannot restart agent.");
        return;
      }
      out.show(true);
      try {
        await agentProcessManager.restart();
        vscode.window.showInformationMessage("Adjutorix agent restarted.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to restart agent: ${msg}`);
      }
    })
  );

  // Diagnostics
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.diagnostics", async () => {
      const report = await buildDiagnosticsReport(
        agentProcessManager?.getStatus() ?? null,
        extensionVersion
      );
      const text = formatDiagnosticsReport(report);
      out.show(true);
      out.appendLine(text);
      vscode.window.showInformationMessage("Adjutorix diagnostics written to Output (Adjutorix).");
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.copyDiagnostics", async () => {
      const report = await buildDiagnosticsReport(
        agentProcessManager?.getStatus() ?? null,
        extensionVersion
      );
      const text = formatDiagnosticsReport(report);
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("Adjutorix diagnostics copied to clipboard.");
    })
  );

  const agentCommands = new AgentCommands(context, rpcClient, state);
  agentCommands.registerAll();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
      if (
        e.affectsConfiguration("adjutorix.agentHost") ||
        e.affectsConfiguration("adjutorix.agentPort") ||
        e.affectsConfiguration("adjutorix.agentUrl")
      ) {
        const url = Settings.getAgentEndpoint();
        if (rpcClient) rpcClient.setEndpoint(`${url}/rpc`);
        if (agentProcessManager) agentProcessManager.setBaseUrl(url);
      }
      if (e.affectsConfiguration("adjutorix.agentMode")) {
        const mode = Settings.get().agentMode;
        if (agentProcessManager) agentProcessManager.setMode(mode);
      }
    })
  );

  // Agent mode commands (set mode from command palette; persist to settings)
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.setAgentModeAuto", () => {
      void Settings.set("agentMode", "auto");
      if (agentProcessManager) agentProcessManager.setMode("auto");
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.setAgentModeManaged", () => {
      void Settings.set("agentMode", "managed");
      if (agentProcessManager) agentProcessManager.setMode("managed");
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("adjutorix.setAgentModeExternal", () => {
      void Settings.set("agentMode", "external");
      if (agentProcessManager) agentProcessManager.setMode("external");
    })
  );

  vscode.window.showInformationMessage("Adjutorix activated.");
}

export function deactivate() {
  if (agentProcessManager) {
    agentProcessManager.stop();
    agentProcessManager = null;
  }
  if (rpcClient) {
    rpcClient.close();
    rpcClient = null;
  }
}
