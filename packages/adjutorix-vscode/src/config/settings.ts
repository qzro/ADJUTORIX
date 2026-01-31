/**
 * Extension settings manager.
 * Maps VS Code configuration to strongly-typed values.
 */

import * as vscode from "vscode";

export interface AdjutorixSettings {
  agentHost: string;
  agentPort: number;
  autoRunCheckOnSave: boolean;
  enableDiagnostics: boolean;
  maxContextFiles: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

const SECTION = "adjutorix";

export class Settings {
  /* -------------------------
   * Public API
   * ------------------------- */

  static get(): AdjutorixSettings {
    const config = vscode.workspace.getConfiguration(SECTION);

    return {
      agentHost: config.get<string>("agentHost", "127.0.0.1"),
      agentPort: config.get<number>("agentPort", 7337),
      autoRunCheckOnSave: config.get<boolean>(
        "autoRunCheckOnSave",
        false
      ),
      enableDiagnostics: config.get<boolean>(
        "enableDiagnostics",
        true
      ),
      maxContextFiles: config.get<number>(
        "maxContextFiles",
        8
      ),
      logLevel: config.get<AdjutorixSettings["logLevel"]>(
        "logLevel",
        "info"
      ),
    };
  }

  static async set<K extends keyof AdjutorixSettings>(
    key: K,
    value: AdjutorixSettings[K],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(SECTION);

    await config.update(key, value, target);
  }

  static onDidChange(
    handler: (settings: AdjutorixSettings) => void
  ): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) {
        handler(this.get());
      }
    });
  }

  /* -------------------------
   * Utilities
   * ------------------------- */

  static getAgentEndpoint(): string {
    const s = this.get();

    return `http://${s.agentHost}:${s.agentPort}`;
  }

  static isDebug(): boolean {
    return this.get().logLevel === "debug";
  }
}
