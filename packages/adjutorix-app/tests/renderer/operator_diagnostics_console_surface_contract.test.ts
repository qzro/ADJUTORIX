import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("operator diagnostics console surface contract", () => {
  it("renders a user-visible diagnostics console inside the app surface", () => {
    const app = read("src/renderer/App.tsx");
    expect(app).toContain("OperatorDiagnosticsConsolePanel");
    expect(app).toContain("<OperatorDiagnosticsConsolePanel />");
  });

  it("binds the console to every governed diagnostics bridge path", () => {
    const panel = read("src/renderer/components/OperatorDiagnosticsConsolePanel.tsx");
    expect(panel).toContain("runtimeSnapshot");
    expect(panel).toContain("startupReport");
    expect(panel).toContain("observabilityBundle");
    expect(panel).toContain("logTail");
    expect(panel).toContain("crashContext");
    expect(panel).toContain("exportBundle");
    expect(panel).toContain("operatorKernel");
  });

  it("declares the diagnostics console as required runtime surface policy", () => {
    const policy = read("../../configs/runtime/operator_diagnostics_console_surface_policy.json");
    expect(policy).toContain("operator_diagnostics_console");
    expect(policy).toContain('"required": true');
    expect(policy).toContain("runtime diagnostics");
    expect(policy).toContain("exportable diagnostics evidence");
  });

  it("keeps the diagnostics console contract in the implemented Vitest suite", () => {
    const config = read("vitest.config.mjs");
    expect(config).toContain("operator_diagnostics_console_surface_contract.test.ts");
  });
});
