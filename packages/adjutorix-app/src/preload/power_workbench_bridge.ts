import { contextBridge, ipcRenderer } from "electron";

const adjutorixPower = Object.freeze({
  openRepository: () => ipcRenderer.invoke("adjutorix-power:open-repository"),
  scanWorkspace: (workspace: string) => ipcRenderer.invoke("adjutorix-power:scan-workspace", workspace),
  readFile: (request: { workspace: string; relativePath: string }) =>
    ipcRenderer.invoke("adjutorix-power:read-file", request),
  saveDraft: (request: { workspace: string; relativePath: string; body: string }) =>
    ipcRenderer.invoke("adjutorix-power:save-draft", request),
  createPlan: (request: { workspace: string; intent: string }) =>
    ipcRenderer.invoke("adjutorix-power:create-plan", request),
  runCommand: (request: { workspace: string; command: string }) =>
    ipcRenderer.invoke("adjutorix-power:run-command", request),
});

contextBridge.exposeInMainWorld("adjutorixPower", adjutorixPower);
