import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(appRoot, "../..");

function readApp(relativePath: string): string {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("operator kernel live surface contract", () => {
  it("renders a user-visible operator kernel cockpit in the app surface", () => {
    const app = readApp("src/renderer/App.tsx");

    expect(app).toContain('data-testid="operator-kernel-live-surface"');
    expect(app).toContain("Operator Kernel Live Cockpit");
    expect(app).toContain("adjutorixOperatorKernel");
    expect(app).toContain("createOperatorKernelReceipt");
    expect(app).toContain("previousKernelHash");
    expect(app).toContain("receiptHash");
    expect(app).toContain("Kernel-gated apply");
  });

  it("keeps kernel evidence across preload patch.apply normalization", () => {
    const preload = readApp("src/preload/preload.ts");

    expect(preload).toContain("operatorKernelReceiptId?: string");
    expect(preload).toContain("operatorKernelHash?: string");
    expect(preload).toContain("operatorKernel?: JsonObject");
    expect(preload).toContain("obj.operatorKernelReceiptId");
    expect(preload).toContain("obj.operatorKernelHash");
    expect(preload).toContain('requireJsonRecord(obj.operatorKernel, "operatorKernel")');
  });

  it("binds cockpit, IPC, and enforcement into one usable path", () => {
    const preload = readApp("src/preload/preload.ts");
    const ipc = readApp("src/main/ipc/operator_kernel_ipc.ts");
    const enforcement = readApp("src/main/operator/operator_kernel_enforcement.ts");
    const policy = readRepo("configs/runtime/operator_kernel_live_surface_policy.json");
    const vitest = readApp("vitest.config.mjs");

    expect(preload).toContain('exposeInMainWorld("adjutorixOperatorKernel"');
    expect(ipc).toContain("adjutorix:operatorKernel:createReceipt");
    expect(ipc).toContain("adjutorix:operatorKernel:lastHash");
    expect(enforcement).toContain("operatorKernelReceiptId");
    expect(enforcement).toContain("operatorKernelHash");
    expect(enforcement).toContain("assertMandatoryOperatorKernelGate");
    expect(policy).toContain("ADJUTORIX_OPERATOR_KERNEL_LIVE_SURFACE");
    expect(vitest).toContain("tests/renderer/operator_kernel_live_surface_contract.test.ts");
  });
});
