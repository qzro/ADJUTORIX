# ADJUTORIX VS Code Extension

**VS Code–only.** Local AI coding agent with governance, diff control, and offline execution.

Adjutorix does **not** run in Cursor or other hosts. If installed there, it will show a single warning and refuse to activate (no commands, no view).

**Invariant:** Every runnable package must contain its own lint configuration. `/check` assumes the package is self-describing (e.g. `packages/adjutorix-vscode/eslint.config.mjs`). Do not rely on root configs or CLI overrides for v1.

---

## Unified reset (final procedure – do once)

One procedure. No branching. No retries. Result: one codebase, one build, VS Code fully enabled, Cursor safely inert.

1. **Quit VS Code and Cursor.**
2. From **repo root** (the directory that contains `packages/` and `tools/`), run:

   ```bash
   ./tools/dev/unified_reset.sh
   ```

   This: kills Code/Cursor processes, nuclear-cleans VS Code + Cursor caches and extensions, builds the extension, and prints the exact command for step 4.
3. **Install once (dev mode):** From repo root, run the command the script printed (use the **full path** to VS Code’s `code` on macOS so Cursor is not opened):

   ```bash
   /Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code --extensionDevelopmentPath=packages/adjutorix-vscode
   ```

   No VSIX. No Marketplace. No duplication.
4. **Verify in VS Code:** Command Palette → **Adjutorix: Show Sidebar** → ADJUTORIX SURFACE v2, actions work. In Cursor: extension may appear; no commands, no sidebar, no activation. That is correct.

Do **not**: reinstall from Marketplace, generate VSIX, duplicate launch configs, or touch Cursor extensions again.

---

## Build and package

From the extension package directory:

```bash
cd packages/adjutorix-vscode
npm install
npm run build
npm run vsix
```

The VSIX is created as `./adjutorix-vscode-0.1.1.vsix` in that directory.

**Verify the VSIX includes the Activity Bar icon** (required for the container to show):

```bash
vsce ls
```

You must see `extension/media/icon.svg`. If it’s missing, the Activity Bar entry can fail; the `package.json` `files` array includes `media/**` for this.

If `vsce package` fails with a secret-scan error (e.g. `Expected concurrency to be an integer`), the “Files included” output is still accurate—the packaging list is correct. Retry or try a different Node/vsce version; the VSIX is only written if the full run succeeds.

---

## Install into VS Code

Use the **VS Code** CLI (not Cursor’s):

```bash
/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code \
  --install-extension "$(pwd)/adjutorix-vscode-0.1.1.vsix" --force
```

Or with a quoted path (avoids space issues in some shells):

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension "$(pwd)/adjutorix-vscode-0.1.1.vsix" --force
```

Then in VS Code: **Developer: Reload Window**.

---

## Uninstall from Cursor (recommended)

If you previously installed the extension into Cursor, remove it so it doesn’t appear there:

```bash
/Applications/Cursor.app/Contents/Resources/app/bin/code \
  --uninstall-extension adjutorix.adjutorix-vscode
```

---

## Verify (VS Code only)

**Binary “done” test:**

1. **Activity Bar** shows the **ADJUTORIX** icon. Click it → sidebar shows the webview (Connected/Disconnected + Check / Fix / Verify / Deploy).
2. If the container is hidden: run **Adjutorix: Show Sidebar** from the Command Palette (View: Open View… → “Adjutorix” also works).
3. **View → Output** → **Adjutorix**: `[guard] ok host: ...`, `activate()`, and action logs when you click buttons.
4. Run **Adjutorix: Smoke Test** → “Adjutorix smoke OK” and `smoke()` in Output.
5. Agent must be running (`./tools/dev/run_agent.sh`) for status to show **Connected**; if the agent is down, the UI still renders and shows **Disconnected**.

---

## Debugging (if the UI is still “empty”)

Do these two binary tests in **VS Code** after **Developer: Reload Window**:

1. **Adjutorix: Smoke Test**  
   Expected: toast “Adjutorix smoke OK”, **Output → Adjutorix** shows `smoke()`.  
   If the command is missing or does nothing → extension didn’t activate or host guard blocked (check guard logic / host name).

2. **Adjutorix: Show Sidebar**  
   Expected: ADJUTORIX activity bar or sidebar view opens.  
   If the view opens but is blank → webview pipeline: check **Output → Adjutorix** for `[view] resolveWebviewView()`, `[view] msg: ...`, `[view] webview boot`.

Then paste these two things for high-signal debugging:

* **Output → Adjutorix** — full contents from start of session.
* **Log (Extension Host)** — lines containing `adjutorix` (use the search/filter).

That distinguishes: guard blocking vs activation OK vs view provider not resolved vs webview script blocked (CSP) vs RPC failing.

---

## Configuration

Settings are defined in `package.json` under `contributes.configuration`; `src/config/schema.json` is internal reference only (VS Code does not load it).

- **adjutorix.agentHost** (default: `127.0.0.1`)
- **adjutorix.agentPort** (default: `7337`) — must match `./tools/dev/run_agent.sh`
- **adjutorix.autoStartAgent** (default: `true`)
- **adjutorix.logLevel** (default: `info`)

Token is read from `~/.adjutorix/token` (created by the agent on first run). Never logged.
