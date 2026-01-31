import * as vscode from "vscode";
import { AgentState } from "./state";
import { registerUiCommands } from "./commands";

/**
 * Main Webview Panel for ADJUTORIX.
 * Hosts chat, diffs, logs, and job state.
 */
export class AdjutorixPanel {
  public static current: AdjutorixPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly state: AgentState;

  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.state = new AgentState();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables
    );

    this.panel.webview.html = this.renderHtml();

    registerUiCommands(this.panel, this.state);
  }

  /**
   * Create or reveal the main panel.
   */
  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.Beside;

    if (AdjutorixPanel.current) {
      AdjutorixPanel.current.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "adjutorix",
      "ADJUTORIX",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "packages/adjutorix-vscode/media"),
        ],
      }
    );

    AdjutorixPanel.current = new AdjutorixPanel(panel, extensionUri);
  }

  /**
   * Handle messages from webview.
   */
  private async onMessage(message: any) {
    switch (message.type) {
      case "ready":
        this.syncState();
        break;

      case "run-command":
        this.state.enqueueCommand(message.payload);
        break;

      case "open-file":
        this.openFile(message.payload.path, message.payload.line);
        break;

      case "clear-logs":
        this.state.clearLogs();
        this.syncState();
        break;

      default:
        console.warn("Unknown webview message:", message);
    }
  }

  /**
   * Sync internal state to UI.
   */
  public syncState() {
    this.panel.webview.postMessage({
      type: "state",
      payload: this.state.serialize(),
    });
  }

  /**
   * Open file at line in editor.
   */
  private async openFile(path: string, line?: number) {
    try {
      const uri = vscode.Uri.file(path);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);

      if (line !== undefined) {
        const pos = new vscode.Position(Math.max(line - 1, 0), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos));
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to open file: ${path}`
      );
    }
  }

  /**
   * Build webview HTML.
   */
  private renderHtml(): string {
    const webview = this.panel.webview;

    const mediaUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "packages/adjutorix-vscode/media"
      )
    );

    const scriptUri = vscode.Uri.joinPath(mediaUri, "main.js");
    const styleUri = vscode.Uri.joinPath(mediaUri, "main.css");

    const nonce = getNonce();

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />

        <meta
          http-equiv="Content-Security-Policy"
          content="
            default-src 'none';
            img-src ${webview.cspSource} https:;
            style-src ${webview.cspSource};
            script-src 'nonce-${nonce}';
          "
        />

        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <link href="${styleUri}" rel="stylesheet" />

        <title>ADJUTORIX</title>
      </head>

      <body>
        <div id="app"></div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          window.__ADJUTORIX__ = { vscode };
        </script>

        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }

  /**
   * Cleanup.
   */
  public dispose() {
    AdjutorixPanel.current = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

/**
 * Generate CSP nonce.
 */
function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}
