import * as vscode from "vscode";
import { RpcClient } from "./client/rpc";
import { AgentPanel } from "./ui/panel";
import { registerCommands } from "./ui/commands";

let rpcClient: RpcClient | null = null;
let panel: AgentPanel | null = null;

/**
 * Extension entry point.
 */
export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("adjutorix");

  const agentUrl = config.get<string>("agentUrl", "http://127.0.0.1:8765");

  rpcClient = new RpcClient(agentUrl);

  panel = new AgentPanel(context, rpcClient);

  registerCommands(context, rpcClient, panel);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("adjutorix.agentUrl")) {
        const newUrl = vscode.workspace
          .getConfiguration("adjutorix")
          .get<string>("agentUrl", agentUrl);

        if (rpcClient && newUrl) {
          rpcClient.setEndpoint(newUrl);
        }
      }
    })
  );

  vscode.window.showInformationMessage("Adjutorix activated.");
}

/**
 * Cleanup on deactivate.
 */
export function deactivate() {
  if (rpcClient) {
    rpcClient.close();
    rpcClient = null;
  }

  panel = null;
}
