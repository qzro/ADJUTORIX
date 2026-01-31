/**
 * Patch apply controller for Adjutorix.
 * Sends approved unified diffs to the local agent for atomic application.
 */

import * as vscode from "vscode";
import { AgentClient } from "../client/rpc";

export class DiffApplier {
  constructor(private readonly agent: AgentClient) {}

  async applyPatch(diff: string): Promise<boolean> {
    if (!diff || diff.trim().length === 0) {
      vscode.window.showErrorMessage("Adjutorix: Empty patch.");
      return false;
    }

    const confirmed = await this.confirmApply(diff);

    if (!confirmed) {
      return false;
    }

    try {
      const result = await this.agent.applyPatch({
        diff,
        atomic: true,
      });

      if (!result.success) {
        vscode.window.showErrorMessage(
          `Adjutorix: Patch failed: ${result.error || "unknown error"}`
        );
        return false;
      }

      vscode.window.showInformationMessage("Adjutorix: Patch applied.");
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Adjutorix: Agent error: ${err?.message || err}`
      );
      return false;
    }
  }

  /* -------------------------
   * Internal
   * ------------------------- */

  private async confirmApply(diff: string): Promise<boolean> {
    const preview = diff.split("\n").slice(0, 20).join("\n");

    const choice = await vscode.window.showWarningMessage(
      "Apply this patch?",
      {
        modal: true,
        detail: `Preview:\n\n${preview}\n\n(Truncated)`,
      },
      "Apply",
      "Cancel"
    );

    return choice === "Apply";
  }
}

/* -------------------------
 * RPC Client Interface
 * ------------------------- */

export interface ApplyPatchRequest {
  diff: string;
  atomic: boolean;
}

export interface ApplyPatchResponse {
  success: boolean;
  error?: string;
}

/**
 * Minimal AgentClient extension.
 * (Implemented in client/rpc.ts)
 */
declare module "../client/rpc" {
  interface AgentClient {
    applyPatch(
      req: ApplyPatchRequest
    ): Promise<ApplyPatchResponse>;
  }
}
