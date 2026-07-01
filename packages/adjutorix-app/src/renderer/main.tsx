import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/adjutorix-power-workbench.css";

type ScanResult = {
  ok: true;
  source: string;
  workspace: string;
  fileCount: number;
  files: Array<{ path: string; name: string; kind: string; size: number }>;
};

type CommandResult = {
  ok: boolean;
  workspace: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type WorkbenchBridge = {
  scanWorkspace: (workspace: string) => Promise<ScanResult>;
  runCommand: (request: { workspace: string; command: string; timeoutMs?: number }) => Promise<CommandResult>;
  gitDiff: (request: { workspace: string; path?: string }) => Promise<{ ok: boolean; output: string }>;
  powerInventory: () => Promise<unknown>;
};

type Workflow = {
  id: string;
  title: string;
  subtitle: string;
  command: string;
  danger?: boolean;
};

type WorkflowState = "idle" | "running" | "ok" | "failed";

declare global {
  interface Window {
    adjutorixUserWorkbench?: WorkbenchBridge;
  }
}

const DEFAULT_WORKSPACE = "/Users/midiakiasat/Downloads/Apps/midiakiasat/qzro/ADJUTORIX";

const WORKFLOWS: Workflow[] = [
  {
    id: "status",
    title: "Status",
    subtitle: "working tree + branch state",
    command: "git status --short && git log --oneline --decorate --max-count=8",
  },
  {
    id: "doctor",
    title: "Doctor",
    subtitle: "workspace and runtime diagnostics",
    command: "bash scripts/doctor.sh",
  },
  {
    id: "check",
    title: "Check",
    subtitle: "repository control check",
    command: "bash scripts/check.sh",
  },
  {
    id: "smoke",
    title: "Smoke",
    subtitle: "operator smoke run",
    command: "bash scripts/smoke.sh",
  },
  {
    id: "verify",
    title: "Verify",
    subtitle: "full verification surface",
    command: "bash scripts/verify.sh",
  },
  {
    id: "build-ts",
    title: "TypeScript",
    subtitle: "app type gate",
    command: "pnpm --filter @adjutorix/app run build:ts",
  },
  {
    id: "ui-contracts",
    title: "UI Contracts",
    subtitle: "core renderer contracts",
    command:
      "pnpm --filter @adjutorix/app exec vitest run tests/renderer/operator_unified_control_spine_contract.test.ts tests/renderer/operator_surface_spine_contract.test.ts tests/renderer/operator_diagnostics_console_surface_contract.test.ts",
  },
  {
    id: "power",
    title: "Power Plane",
    subtitle: "21 package runtime verify",
    command: "pnpm power:all",
  },
  {
    id: "ledger",
    title: "Ledger",
    subtitle: "current ledger view",
    command: "bash scripts/ledger/current.sh || true",
  },
  {
    id: "workspace-health",
    title: "Workspace Health",
    subtitle: "trust + workspace health",
    command: "bash scripts/workspace/health.sh || true",
  },
  {
    id: "diff",
    title: "Diff",
    subtitle: "current source delta",
    command: "git diff --stat && git diff -- packages/adjutorix-app/src/renderer/main.tsx packages/adjutorix-app/src/preload/preload.ts packages/adjutorix-app/src/renderer/styles/adjutorix-power-workbench.css",
  },
  {
    id: "clean",
    title: "Clean Generated",
    subtitle: "remove build output from repo tree",
    command:
      "rm -rf .tmp packages/adjutorix-app/dist packages/adjutorix-app/release reports/current/adjutorix-power-plane-verify.json reports/current/pr110-ci-failures && git status --short",
    danger: true,
  },
];

function requiredWorkflow(id: string): Workflow {
  const workflow = WORKFLOWS.find((candidate) => candidate.id === id);

  if (!workflow) {
    throw new Error(`missing_workflow:${id}`);
  }

  return workflow;
}

function bridge(): WorkbenchBridge {
  const candidate = window.adjutorixUserWorkbench;

  if (!candidate) {
    throw new Error("adjutorixUserWorkbench bridge unavailable");
  }

  return candidate;
}

function initialWorkflowState(): Record<string, WorkflowState> {
  return Object.fromEntries(WORKFLOWS.map((workflow) => [workflow.id, "idle" as WorkflowState]));
}

function shortCommand(command: string): string {
  return command.length > 62 ? `${command.slice(0, 62)}…` : command;
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);
  const [fileCount, setFileCount] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  const [testCount, setTestCount] = useState(0);
  const [configCount, setConfigCount] = useState(0);
  const [powerCount, setPowerCount] = useState("0/21");
  const [consoleStatus, setConsoleStatus] = useState("booting");
  const [busy, setBusy] = useState(false);
  const [lastCommand, setLastCommand] = useState("none");
  const [customCommand, setCustomCommand] = useState("git status --short");
  const [output, setOutput] = useState("Adjutorix Operator Console is booting.");
  const [states, setStates] = useState<Record<string, WorkflowState>>(initialWorkflowState());

  const failedCount = useMemo(() => Object.values(states).filter((state) => state === "failed").length, [states]);
  const okCount = useMemo(() => Object.values(states).filter((state) => state === "ok").length, [states]);

  async function loadProject(): Promise<void> {
    setBusy(true);
    setConsoleStatus("loading project");

    try {
      const result = await bridge().scanWorkspace(workspace);
      setWorkspace(result.workspace);
      setFileCount(result.fileCount);
      setSourceCount(result.files.filter((file) => file.kind === "source").length);
      setTestCount(result.files.filter((file) => file.kind === "test").length);
      setConfigCount(result.files.filter((file) => file.kind === "config").length);
      setConsoleStatus("project ready");
      setOutput(`PROJECT READY\n${result.workspace}\n${result.fileCount} usable files\n${result.source}`);

      console.info(
        "ADJUTORIX_OPERATOR_CONSOLE_READY",
        JSON.stringify({
          workspace: result.workspace,
          files: result.fileCount,
          source: result.source,
        }),
      );
    } catch (error) {
      setConsoleStatus("project load failed");
      setOutput(String(error));
      console.error("ADJUTORIX_OPERATOR_CONSOLE_LOAD_FAILED", error);
    } finally {
      setBusy(false);
    }
  }

  async function loadPower(): Promise<void> {
    try {
      const payload = await bridge().powerInventory();
      const record = payload as { installedCount?: number; expectedCount?: number };
      const value = `${record.installedCount ?? 0}/${record.expectedCount ?? 21}`;
      setPowerCount(value);

      console.info(
        "ADJUTORIX_OPERATOR_POWER_READY",
        JSON.stringify({
          installed: record.installedCount ?? 0,
          expected: record.expectedCount ?? 21,
        }),
      );
    } catch (error) {
      setPowerCount("error");
      console.error("ADJUTORIX_OPERATOR_POWER_FAILED", error);
    }
  }

  async function runWorkflow(workflow: Workflow): Promise<void> {
    setBusy(true);
    setLastCommand(workflow.command);
    setConsoleStatus(`running ${workflow.title}`);
    setStates((current) => ({ ...current, [workflow.id]: "running" }));

    try {
      const result = await bridge().runCommand({
        workspace,
        command: workflow.command,
        timeoutMs: 240000,
      });

      const text = [
        `ADJUTORIX WORKFLOW: ${workflow.title}`,
        `command: ${workflow.command}`,
        `exit=${result.exitCode} timedOut=${result.timedOut}`,
        "",
        result.stdout,
        result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
      ].join("\n");

      setOutput(text);
      setConsoleStatus(result.ok ? `${workflow.title} ok` : `${workflow.title} failed`);
      setStates((current) => ({ ...current, [workflow.id]: result.ok ? "ok" : "failed" }));

      console.info(
        "ADJUTORIX_OPERATOR_WORKFLOW_DONE",
        JSON.stringify({
          id: workflow.id,
          ok: result.ok,
          exitCode: result.exitCode,
        }),
      );
    } catch (error) {
      setOutput(String(error));
      setConsoleStatus(`${workflow.title} failed`);
      setStates((current) => ({ ...current, [workflow.id]: "failed" }));
    } finally {
      setBusy(false);
    }
  }

  async function runCustom(): Promise<void> {
    await runWorkflow({
      id: "custom",
      title: "Custom Command",
      subtitle: "operator command",
      command: customCommand,
    });
  }

  useEffect(() => {
    document.documentElement.dataset.adjutorixOperatorConsole = "true";
    document.body.dataset.adjutorixOperatorConsole = "true";
    console.info("ADJUTORIX_OPERATOR_CONSOLE_MOUNTED");

    void loadProject();
    void loadPower();

    setTimeout(() => {
      void runWorkflow(requiredWorkflow("status"));
    }, 500);
  }, []);

  return (
    <main className="operator-shell">
      <aside className="operator-left">
        <header className="operator-brand">
          <div className="operator-mark">A</div>
          <div>
            <strong>Adjutorix</strong>
            <span>operator console</span>
          </div>
        </header>

        <section className="workspace-panel">
          <label>Workspace</label>
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
          <button onClick={() => void loadProject()} disabled={busy}>Reload workspace</button>
        </section>

        <section className="big-status">
          <strong>{consoleStatus}</strong>
          <span>{busy ? "operator running" : "operator idle"}</span>
        </section>

        <section className="metric-grid">
          <div><strong>{fileCount}</strong><span>usable files</span></div>
          <div><strong>{sourceCount}</strong><span>source</span></div>
          <div><strong>{testCount}</strong><span>tests</span></div>
          <div><strong>{configCount}</strong><span>config</span></div>
          <div><strong>{powerCount}</strong><span>power</span></div>
          <div><strong>{okCount}/{failedCount}</strong><span>ok/fail</span></div>
        </section>

        <section className="operator-summary">
          <h2>Not a file reader</h2>
          <p>Adjutorix runs local operator workflows: status, doctor, check, smoke, verify, build, ledger, power and recovery.</p>
        </section>
      </aside>

      <section className="operator-main">
        <header className="operator-topbar">
          <div>
            <strong>Mission Control</strong>
            <span>Run the product. Produce evidence. Fix from output.</span>
          </div>

          <div className="top-actions">
            <button onClick={() => void runWorkflow(requiredWorkflow("status"))} disabled={busy}>Status</button>
            <button onClick={() => void runWorkflow(requiredWorkflow("verify"))} disabled={busy}>Verify</button>
            <button onClick={() => void runWorkflow(requiredWorkflow("power"))} disabled={busy}>Power</button>
          </div>
        </header>

        <section className="workflow-grid">
          {WORKFLOWS.map((workflow) => (
            <button
              key={workflow.id}
              className={`workflow-card ${states[workflow.id]} ${workflow.danger ? "danger" : ""}`}
              onClick={() => void runWorkflow(workflow)}
              disabled={busy}
            >
              <span>{states[workflow.id]}</span>
              <strong>{workflow.title}</strong>
              <small>{workflow.subtitle}</small>
              <code>{shortCommand(workflow.command)}</code>
            </button>
          ))}
        </section>

        <section className="custom-runner">
          <div>
            <strong>Operator command</strong>
            <span>Run inside the selected workspace</span>
          </div>
          <textarea value={customCommand} onChange={(event) => setCustomCommand(event.target.value)} />
          <button onClick={() => void runCustom()} disabled={busy}>Run custom</button>
        </section>
      </section>

      <aside className="operator-output">
        <header>
          <div>
            <strong>Evidence Output</strong>
            <span>{lastCommand}</span>
          </div>
        </header>

        <pre>{output}</pre>
      </aside>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Adjutorix root element not found");
}

createRoot(root).render(<App />);
