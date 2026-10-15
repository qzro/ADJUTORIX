import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const source = (name: string): string => readFileSync(resolve(process.cwd(), name), "utf8");
describe("MIDIA authenticated native UI is actually mounted", () => {
  it("binds the visible product deck used by the live renderer", () => {
    expect(source("src/renderer/main.tsx")).toContain("<ProductSurfaceOrchestrator />");
    expect(source("src/renderer/components/ProductSurfaceOrchestrator.tsx"))
      .toContain("<MidiaConnectionPanel />");
    const ui = source("src/renderer/components/MidiaConnectionPanel.tsx");
    expect(ui).toContain("adjutorixMidia");
    expect(ui).toContain("MIDIA-AI connected source");
    expect(ui).not.toContain("ipcRenderer");
    expect(ui).not.toContain("key_hex");
  });
  it("keeps HMAC credentials confined to the Electron main process", () => {
    expect(source("src/main/index.ts")).toContain("registerMidiaNativeIpc(ipcMain)");
    expect(source("src/preload/preload.ts")).toContain('exposeInMainWorld("adjutorixMidia"');
    const native = source("src/main/midia-native-channel.ts");
    expect(native).not.toContain("adjutorix:midia:execute");
    expect(native).toContain("DESKTOP_RESPONSE_AUTHENTICATION_DENIED");
  });
});
