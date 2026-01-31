/**
 * Diff preview renderer for Adjutorix.
 * Shows unified diffs inside VS Code webview panel.
 */

import * as vscode from "vscode";

export class DiffPreview {
  private panel: vscode.WebviewPanel | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  show(diff: string, title: string = "Adjutorix Diff Preview") {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "adjutorixDiffPreview",
        title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: false,
          retainContextWhenHidden: true,
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = null;
      });
    }

    this.panel.webview.html = this.renderHtml(diff);
  }

  dispose() {
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
  }

  /* -------------------------
   * Internal
   * ------------------------- */

  private renderHtml(diff: string): string {
    const escaped = this.escapeHtml(diff);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<title>Adjutorix Diff</title>

<style>
  body {
    font-family: monospace;
    background: #0f172a;
    color: #e5e7eb;
    margin: 0;
    padding: 16px;
  }

  .diff {
    white-space: pre;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.5;
  }

  .add {
    background: rgba(34,197,94,0.15);
    color: #4ade80;
  }

  .del {
    background: rgba(239,68,68,0.15);
    color: #f87171;
  }

  .meta {
    color: #60a5fa;
  }
</style>
</head>

<body>
<pre class="diff">${this.highlight(escaped)}</pre>
</body>
</html>`;
  }

  private highlight(diff: string): string {
    return diff
      .split("\n")
      .map((line) => {
        if (line.startsWith("+++ ") || line.startsWith("--- ")) {
          return `<span class="meta">${line}</span>`;
        }

        if (line.startsWith("@@")) {
          return `<span class="meta">${line}</span>`;
        }

        if (line.startsWith("+")) {
          return `<span class="add">${line}</span>`;
        }

        if (line.startsWith("-")) {
          return `<span class="del">${line}</span>`;
        }

        return line;
      })
      .join("\n");
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
