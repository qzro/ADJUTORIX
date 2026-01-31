/**
 * Diagnostic output parser for Adjutorix.
 * Converts tool output into VS Code compatible file:line diagnostics.
 */

import * as vscode from "vscode";

export interface ParsedDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: vscode.DiagnosticSeverity;
  message: string;
  source: string;
}

/**
 * Supported patterns:
 *  file:line:col: message
 *  file:line: message
 */
const PATTERNS: RegExp[] = [
  // file:line:col: message
  /^(.*?):(\d+):(\d+):\s*(.+)$/,

  // file:line: message
  /^(.*?):(\d+):\s*(.+)$/
];

export class DiagnosticParser {
  static parse(output: string, source = "adjutorix"): ParsedDiagnostic[] {
    const diagnostics: ParsedDiagnostic[] = [];

    if (!output || output.trim().length === 0) {
      return diagnostics;
    }

    const lines = output.split(/\r?\n/);

    for (const line of lines) {
      const parsed = this.parseLine(line, source);
      if (parsed) {
        diagnostics.push(parsed);
      }
    }

    return diagnostics;
  }

  /* -------------------------
   * Internal
   * ------------------------- */

  private static parseLine(
    line: string,
    source: string
  ): ParsedDiagnostic | null {
    const trimmed = line.trim();

    if (!trimmed) return null;

    for (const pattern of PATTERNS) {
      const match = trimmed.match(pattern);

      if (!match) continue;

      if (match.length === 5) {
        // file:line:col: msg
        return {
          file: match[1],
          line: parseInt(match[2], 10) - 1,
          column: parseInt(match[3], 10) - 1,
          severity: this.inferSeverity(match[4]),
          message: match[4],
          source
        };
      }

      if (match.length === 4) {
        // file:line: msg
        return {
          file: match[1],
          line: parseInt(match[2], 10) - 1,
          column: 0,
          severity: this.inferSeverity(match[3]),
          message: match[3],
          source
        };
      }
    }

    return null;
  }

  private static inferSeverity(
    message: string
  ): vscode.DiagnosticSeverity {
    const msg = message.toLowerCase();

    if (msg.includes("error") || msg.includes("failed")) {
      return vscode.DiagnosticSeverity.Error;
    }

    if (msg.includes("warn")) {
      return vscode.DiagnosticSeverity.Warning;
    }

    if (msg.includes("info") || msg.includes("note")) {
      return vscode.DiagnosticSeverity.Information;
    }

    return vscode.DiagnosticSeverity.Hint;
  }
}
