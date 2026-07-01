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

type ActionGroup = "connect" | "verify" | "operate" | "recover";

type ControlAction = {
  id: string;
  group: ActionGroup;
  title: string;
  subtitle: string;
  command: string;
  allowFailure?: boolean;
  critical?: boolean;
};

type RunState = "idle" | "running" | "ok" | "failed";

declare global {
  interface Window {
    adjutorixUserWorkbench?: WorkbenchBridge;
  }
}

const DEFAULT_WORKSPACE = "/Users/midiakiasat/Downloads/Apps/midiakiasat/qzro/ADJUTORIX";

const ACTIONS: ControlAction[] = [
  {
    id: "agent-status",
    group: "connect",
    title: "Agent Status",
    subtitle: "check local Adjutorix agent",
    command: "bash scripts/agent/status.sh",
    allowFailure: true,
  },
  {
    id: "agent-start",
    group: "connect",
    title: "Start Agent",
    subtitle: "boot local agent service",
    command: "bash scripts/agent/start.sh && bash scripts/agent/status.sh",
    critical: true,
  },
  {
    id: "agent-restart",
    group: "connect",
    title: "Restart Agent",
    subtitle: "hard reconnect runtime",
    command: "bash scripts/agent/restart.sh && bash scripts/agent/status.sh",
    critical: true,
  },
  {
    id: "agent-logs",
    group: "connect",
    title: "Agent Logs",
    subtitle: "latest agent evidence",
    command: "bash scripts/agent/logs.sh || true",
    allowFailure: true,
  },
  {
    id: "git-status",
    group: "operate",
    title: "Git Status",
    subtitle: "working tree and branch",
    command: "git status --short && git log --oneline --decorate --max-count=8",
  },
  {
    id: "doctor",
    group: "operate",
    title: "Doctor",
    subtitle: "runtime diagnostics",
    command: "bash scripts/doctor.sh",
    allowFailure: true,
  },
  {
    id: "check",
    group: "verify",
    title: "Check",
    subtitle: "repository control gate",
    command: "bash scripts/check.sh",
    critical: true,
  },
  {
    id: "smoke",
    group: "verify",
    title: "Smoke",
    subtitle: "operator smoke surface",
    command: "bash scripts/smoke.sh",
    critical: true,
  },
  {
    id: "verify",
    group: "verify",
    title: "Verify",
    subtitle: "full verification gate",
    command: "bash scripts/verify.sh",
    critical: true,
  },
  {
    id: "verify-run",
    group: "verify",
    title: "Verify Run",
    subtitle: "verification runner",
    command: "bash scripts/verify/run.sh",
    critical: true,
  },
  {
    id: "verify-summary",
    group: "verify",
    title: "Verify Summary",
    subtitle: "latest verification summary",
    command: "bash scripts/verify/summary.sh || true",
    allowFailure: true,
  },
  {
    id: "typescript",
    group: "verify",
    title: "TypeScript",
    subtitle: "desktop app type gate",
    command: "pnpm --filter @adjutorix/app run build:ts",
    critical: true,
  },
  {
    id: "power",
    group: "connect",
    title: "Power Packages",
    subtitle: "21 package runtime plane",
    command: "pnpm power:all",
    critical: true,
  },
  {
    id: "ledger-current",
    group: "operate",
    title: "Ledger Current",
    subtitle: "current ledger head",
    command: "bash scripts/ledger/current.sh || true",
    allowFailure: true,
  },
  {
    id: "ledger-graph",
    group: "operate",
    title: "Ledger Graph",
    subtitle: "transaction graph",
    command: "bash scripts/ledger/graph.sh || true",
    allowFailure: true,
  },
  {
    id: "transaction-status",
    group: "operate",
    title: "Transactions",
    subtitle: "active transaction status",
    command: "bash scripts/transaction/status.sh || true",
    allowFailure: true,
  },
  {
    id: "governance",
    group: "operate",
    title: "Governance",
    subtitle: "policy and constitution check",
    command: "bash scripts/governance/check.sh",
    critical: true,
  },
  {
    id: "workspace-health",
    group: "operate",
    title: "Workspace Health",
    subtitle: "trust and workspace health",
    command: "bash scripts/workspace/health.sh || true",
    allowFailure: true,
  },
  {
    id: "recovery-resume",
    group: "recover",
    title: "Recovery Status",
    subtitle: "resume / recovery visibility",
    command: "bash scripts/recovery/resume.sh || true",
    allowFailure: true,
  },
  {
    id: "clean-tree",
    group: "recover",
    title: "Clean Generated",
    subtitle: "remove generated output",
    command:
      "rm -rf .tmp packages/adjutorix-app/dist packages/adjutorix-app/release reports/current/adjutorix-power-plane-verify.json reports/current/pr110-ci-failures && git status --short",
  },
];

function bridge(): WorkbenchBridge {
  const candidate = window.adjutorixUserWorkbench;

  if (!candidate) {
    throw new Error("adjutorixUserWorkbench bridge unavailable");
  }

  return candidate;
}

function actionById(id: string): ControlAction {
  const action = ACTIONS.find((candidate) => candidate.id === id);

  if (!action) {
    throw new Error(`missing_action:${id}`);
  }

  return action;
}

function initialStates(): Record<string, RunState> {
  return Object.fromEntries(ACTIONS.map((action) => [action.id, "idle" as RunState]));
}

function groupTitle(group: ActionGroup): string {
  if (group === "connect") return "Connect";
  if (group === "verify") return "Verify";
  if (group === "operate") return "Operate";
  return "Recover";
}

function timeStamp(): string {
  return new Date().toLocaleTimeString();
}

function compact(text: string): string {
  return text.length > 92 ? `${text.slice(0, 92)}…` : text;
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);
  const [fileCount, setFileCount] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  const [testCount, setTestCount] = useState(0);
  const [configCount, setConfigCount] = useState(0);
  const [powerCount, setPowerCount] = useState("0/21");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState("none");
  const [customCommand, setCustomCommand] = useState("git status --short");
  const [states, setStates] = useState<Record<string, RunState>>(initialStates());
  const [evidence, setEvidence] = useState("Adjutorix Control Center booting.");

  const grouped = useMemo(
    () =>
      (["connect", "verify", "operate", "recover"] as ActionGroup[]).map((group) => ({
        group,
        actions: ACTIONS.filter((action) => action.group === group),
      })),
    [],
  );

  const okCount = useMemo(() => Object.values(states).filter((state) => state === "ok").length, [states]);
  const failCount = useMemo(() => Object.values(states).filter((state) => state === "failed").length, [states]);
  const running = busyAction !== null;

  function appendEvidence(text: string): void {
    setEvidence((current) => `${current}\n\n[${timeStamp()}]\n${text}`.slice(-90000));
  }

  async function loadWorkspace(target = workspace): Promise<void> {
    setBusyAction("workspace");

    try {
      const result = await bridge().scanWorkspace(target);
      setWorkspace(result.workspace);
      setFileCount(result.fileCount);
      setSourceCount(result.files.filter((file) => file.kind === "source").length);
      setTestCount(result.files.filter((file) => file.kind === "test").length);
      setConfigCount(result.files.filter((file) => file.kind === "config").length);

      appendEvidence(`WORKSPACE CONNECTED\n${result.workspace}\n${result.fileCount} usable files\nsource=${result.source}`);

      console.info(
        "ADJUTORIX_CONTROL_CENTER_READY",
        JSON.stringify({
          workspace: result.workspace,
          files: result.fileCount,
          source: result.source,
        }),
      );
    } catch (error) {
      appendEvidence(`WORKSPACE FAILED\n${String(error)}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function loadPower(): Promise<void> {
    try {
      const payload = await bridge().powerInventory();
      const record = payload as { installedCount?: number; expectedCount?: number };
      const count = `${record.installedCount ?? 0}/${record.expectedCount ?? 21}`;
      setPowerCount(count);

      appendEvidence(`POWER CONNECTED\n${count} packages available`);

      console.info(
        "ADJUTORIX_CONTROL_POWER_READY",
        JSON.stringify({
          installed: record.installedCount ?? 0,
          expected: record.expectedCount ?? 21,
        }),
      );
    } catch (error) {
      setPowerCount("error");
      appendEvidence(`POWER FAILED\n${String(error)}`);
    }
  }

  async function runAction(action: ControlAction, workspaceOverride = workspace): Promise<void> {
    setBusyAction(action.id);
    setLastCommand(action.command);
    setStates((current) => ({ ...current, [action.id]: "running" }));

    try {
      const result = await bridge().runCommand({
        workspace: workspaceOverride,
        command: action.command,
        timeoutMs: 240000,
      });

      const ok = result.ok || action.allowFailure === true;
      setStates((current) => ({ ...current, [action.id]: ok ? "ok" : "failed" }));

      appendEvidence(
        [
          `ACTION: ${action.title}`,
          `GROUP: ${groupTitle(action.group)}`,
          `$ ${result.command}`,
          `exit=${result.exitCode} timedOut=${result.timedOut} ok=${ok}`,
          "",
          result.stdout || "(no stdout)",
          result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
        ].join("\n"),
      );

      console.info(
        "ADJUTORIX_CONTROL_WORKFLOW_DONE",
        JSON.stringify({
          id: action.id,
          ok,
          exitCode: result.exitCode,
        }),
      );
    } catch (error) {
      setStates((current) => ({ ...current, [action.id]: "failed" }));
      appendEvidence(`ACTION FAILED: ${action.title}\n${String(error)}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function runCustom(): Promise<void> {
    await runAction({
      id: "custom-command",
      group: "operate",
      title: "Custom Command",
      subtitle: "manual operator command",
      command: customCommand,
      allowFailure: true,
    });
  }

  async function boot(): Promise<void> {
    document.documentElement.dataset.adjutorixControlCenter = "true";
    document.body.dataset.adjutorixControlCenter = "true";
    console.info("ADJUTORIX_CONTROL_CENTER_MOUNTED");

    await loadWorkspace(DEFAULT_WORKSPACE);
    await loadPower();
    await runAction(actionById("git-status"), DEFAULT_WORKSPACE);
  }

  useEffect(() => {
    void boot();
  }, []);

  return (
    <main className="control-shell">
      <aside className="control-left">
        <header className="brand-row">
          <div className="brand-mark">A</div>
          <div>
            <strong>Adjutorix</strong>
            <span>control center</span>
          </div>
        </header>

        <section className="workspace-box">
          <label>Workspace</label>
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
          <button onClick={() => void loadWorkspace()} disabled={running}>Connect workspace</button>
        </section>

        <section className="connection-state">
          <strong>{running ? `running ${busyAction}` : "ready"}</strong>
          <span>{lastCommand}</span>
        </section>

        <section className="metric-grid">
          <div><strong>{fileCount}</strong><span>files</span></div>
          <div><strong>{sourceCount}</strong><span>source</span></div>
          <div><strong>{testCount}</strong><span>tests</span></div>
          <div><strong>{configCount}</strong><span>config</span></div>
          <div><strong>{powerCount}</strong><span>power</span></div>
          <div><strong>{okCount}/{failCount}</strong><span>ok/fail</span></div>
        </section>

        <section className="primary-stack">
          <button onClick={() => void runAction(actionById("agent-start"))} disabled={running}>Start Agent</button>
          <button onClick={() => void runAction(actionById("verify"))} disabled={running}>Run Verify</button>
          <button onClick={() => void runAction(actionById("power"))} disabled={running}>Power Check</button>
        </section>
      </aside>

      <section className="control-main">
        <header className="mission-header">
          <div>
            <strong>Mission Control</strong>
            <span>Connect runtime. Run gates. Produce evidence. Recover from failures.</span>
          </div>

          <div className="mission-actions">
            <button onClick={() => void runAction(actionById("agent-status"))} disabled={running}>Agent</button>
            <button onClick={() => void runAction(actionById("git-status"))} disabled={running}>Status</button>
            <button onClick={() => void runAction(actionById("verify-run"))} disabled={running}>Verify</button>
            <button onClick={() => void runAction(actionById("clean-tree"))} disabled={running}>Clean</button>
          </div>
        </header>

        <section className="lanes">
          {grouped.map((lane) => (
            <section className="lane" key={lane.group}>
              <header>{groupTitle(lane.group)}</header>
              <div className="lane-actions">
                {lane.actions.map((action) => (
                  <button
                    key={action.id}
                    className={`action-card ${states[action.id]} ${action.critical ? "critical" : ""}`}
                    onClick={() => void runAction(action)}
                    disabled={running}
                  >
                    <span>{states[action.id]}</span>
                    <strong>{action.title}</strong>
                    <small>{action.subtitle}</small>
                    <code>{compact(action.command)}</code>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </section>

        <section className="manual-command">
          <div>
            <strong>Operator command</strong>
            <span>Runs inside connected workspace</span>
          </div>
          <textarea value={customCommand} onChange={(event) => setCustomCommand(event.target.value)} />
          <button onClick={() => void runCustom()} disabled={running}>Run</button>
        </section>
      </section>

      <aside className="evidence-panel">
        <header>
          <strong>Evidence Stream</strong>
          <span>{running ? "live" : "idle"}</span>
        </header>
        <pre>{evidence}</pre>
      </aside>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Adjutorix root element not found");
}

createRoot(root).render(<App />);
