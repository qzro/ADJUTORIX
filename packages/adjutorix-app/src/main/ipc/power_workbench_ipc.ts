import { dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type WorkbenchEntry = {
  name: string;
  absolutePath: string;
  relativePath: string;
  kind: "file" | "directory";
  depth: number;
  sizeBytes?: number;
};

type ReadFileRequest = {
  workspace: string;
  relativePath: string;
};

type SaveDraftRequest = {
  workspace: string;
  relativePath: string;
  body: string;
};

type CommandRequest = {
  workspace: string;
  command: string;
};

let registered = false;
let currentWorkspace: string | null = null;

const ignoredNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  "__pycache__",
  ".turbo",
  ".next",
  ".venv",
  "venv",
]);

function normalizeWorkspace(input: string): string {
  return path.resolve(input);
}

function assertInsideWorkspace(workspace: string, target: string): string {
  const root = normalizeWorkspace(workspace);
  const resolved = path.resolve(root, target);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path escapes workspace boundary.");
  }

  return resolved;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".json") return "json";
  if (ext === ".md" || ext === ".mdx") return "markdown";
  if (ext === ".py") return "python";
  if (ext === ".css") return "css";
  if (ext === ".html") return "html";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  if (ext === ".sh") return "shell";
  if (ext === ".sql") return "sql";

  return "plaintext";
}

async function scanTree(workspace: string, maxDepth = 4, maxEntries = 900): Promise<WorkbenchEntry[]> {
  const root = normalizeWorkspace(workspace);
  const entries: WorkbenchEntry[] = [];

  async function walk(relativeDir: string, depth: number): Promise<void> {
    if (entries.length >= maxEntries) return;

    const absoluteDir = assertInsideWorkspace(root, relativeDir);
    const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });

    const sorted = dirents
      .filter((entry) => !ignoredNames.has(entry.name))
      .filter((entry) => !entry.name.endsWith(".pyc"))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const dirent of sorted) {
      if (entries.length >= maxEntries) break;

      const relativePath = path.join(relativeDir, dirent.name);
      const absolutePath = assertInsideWorkspace(root, relativePath);
      const kind = dirent.isDirectory() ? "directory" : "file";

      const item: WorkbenchEntry = {
        name: dirent.name,
        absolutePath,
        relativePath,
        kind,
        depth,
      };

      if (kind === "file") {
        try {
          const stat = await fs.stat(absolutePath);
          item.sizeBytes = stat.size;
        } catch {
          item.sizeBytes = undefined;
        }
      }

      entries.push(item);

      if (kind === "directory" && depth < maxDepth) {
        await walk(relativePath, depth + 1);
      }
    }
  }

  await walk("", 0);
  return entries;
}

async function readTextFile(workspace: string, relativePath: string): Promise<{
  relativePath: string;
  body: string;
  language: string;
}> {
  const absolutePath = assertInsideWorkspace(workspace, relativePath);
  const stat = await fs.stat(absolutePath);

  if (!stat.isFile()) {
    throw new Error("Selected path is not a file.");
  }

  if (stat.size > 1_500_000) {
    throw new Error("File is too large for editor preview.");
  }

  const body = await fs.readFile(absolutePath, "utf8");

  return {
    relativePath,
    body,
    language: detectLanguage(relativePath),
  };
}

async function writeDraft(request: SaveDraftRequest): Promise<{ draftPath: string }> {
  const workspace = normalizeWorkspace(request.workspace);
  const draftRoot = assertInsideWorkspace(workspace, ".adjutorix/workbench-drafts");
  await fs.mkdir(draftRoot, { recursive: true });

  const safeName = request.relativePath.replace(/[^a-zA-Z0-9._-]+/g, "__");
  const draftPath = path.join(draftRoot, `${safeName}.draft`);

  await fs.writeFile(draftPath, request.body, "utf8");

  return { draftPath };
}

async function createIntentPlan(workspace: string, intent: string): Promise<{ planPath: string; body: string }> {
  const root = normalizeWorkspace(workspace);
  const objectRoot = assertInsideWorkspace(root, ".adjutorix/objects");
  await fs.mkdir(objectRoot, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = path.join(objectRoot, `intent-plan-${stamp}.json`);

  const body = JSON.stringify(
    {
      schema: "adjutorix.intent.plan.v1",
      workspace: root,
      intent,
      constraints: [
        "no direct apply without patch custody",
        "verification required before apply",
        "receipt required after apply",
        "rollback receipt required for rollback",
      ],
      status: "ready_for_patch_custody",
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  );

  await fs.writeFile(planPath, body, "utf8");

  return { planPath, body };
}

async function runCommand(request: CommandRequest): Promise<{
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const workspace = normalizeWorkspace(request.workspace);
  const command = request.command.trim();

  if (!command) {
    throw new Error("Empty command.");
  }

  await fs.stat(workspace);

  return await new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd: workspace,
      env: {
        ...process.env,
        ADJUTORIX_WORKBENCH: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Command timed out."));
    }, 120_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 400_000) stdout = stdout.slice(-400_000);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 400_000) stderr = stderr.slice(-400_000);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        command,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

export function registerPowerWorkbenchIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("adjutorix-power:open-repository", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open repository in Adjutorix",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const workspace = normalizeWorkspace(result.filePaths[0] ?? "");
    currentWorkspace = workspace;

    return {
      workspace,
      tree: await scanTree(workspace),
    };
  });

  ipcMain.handle("adjutorix-power:scan-workspace", async (_event, workspace: string) => {
    const resolved = normalizeWorkspace(workspace || currentWorkspace || "");
    currentWorkspace = resolved;

    return {
      workspace: resolved,
      tree: await scanTree(resolved),
    };
  });

  ipcMain.handle("adjutorix-power:read-file", async (_event, request: ReadFileRequest) => {
    return await readTextFile(request.workspace, request.relativePath);
  });

  ipcMain.handle("adjutorix-power:save-draft", async (_event, request: SaveDraftRequest) => {
    return await writeDraft(request);
  });

  ipcMain.handle("adjutorix-power:create-plan", async (_event, request: { workspace: string; intent: string }) => {
    return await createIntentPlan(request.workspace, request.intent);
  });

  ipcMain.handle("adjutorix-power:run-command", async (_event, request: CommandRequest) => {
    return await runCommand(request);
  });
}
