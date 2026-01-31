/**
 * Publishes parsed diagnostics to the VS Code Problems panel.
 */

import * as vscode from "vscode";
import { ParsedDiagnostic } from "./parse";

export class DiagnosticPublisher {
  private static collection: vscode.DiagnosticCollection | null = null;

  /* -------------------------
   * Lifecycle
   * ------------------------- */

  static initialize(): void {
    if (!this.collection) {
      this.collection = vscode.languages.createDiagnosticCollection(
        "adjutorix"
      );
    }
  }

  static dispose(): void {
    if (this.collection) {
      this.collection.dispose();
      this.collection = null;
    }
  }

  /* -------------------------
   * Publish API
   * ------------------------- */

  static publish(diagnostics: ParsedDiagnostic[]): void {
    if (!this.collection) {
      this.initialize();
    }

    if (!this.collection) return;

    const grouped = this.groupByFile(diagnostics);

    this.collection.clear();

    for (const [file, items] of grouped.entries()) {
      const uri = vscode.Uri.file(file);

      const vsDiagnostics = items.map((item) =>
        this.toVscodeDiagnostic(item)
      );

      this.collection.set(uri, vsDiagnostics);
    }
  }

  static clear(): void {
    if (this.collection) {
      this.collection.clear();
    }
  }

  /* -------------------------
   * Internal
   * ------------------------- */

  private static groupByFile(
    diagnostics: ParsedDiagnostic[]
  ): Map<string, ParsedDiagnostic[]> {
    const map = new Map<string, ParsedDiagnostic[]>();

    for (const diag of diagnostics) {
      if (!map.has(diag.file)) {
        map.set(diag.file, []);
      }

      map.get(diag.file)!.push(diag);
    }

    return map;
  }

  private static toVscodeDiagnostic(
    parsed: ParsedDiagnostic
  ): vscode.Diagnostic {
    const range = new vscode.Range(
      parsed.line,
      parsed.column,
      parsed.line,
      parsed.column + 1
    );

    const diagnostic = new vscode.Diagnostic(
      range,
      parsed.message,
      parsed.severity
    );

    diagnostic.source = parsed.source;

    return diagnostic;
  }
}
