// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";

const MARKER = "ADJUTORIX_NATIVE_PORTFOLIO_HOST_WORKBENCH_V18";

function api() {
  const w = window as any;
  return w.adjutorixPortfolioV18;
}

function lang(path: string) {
  const p = path.toLowerCase();
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".mjs") || p.endsWith(".cjs")) return "javascript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md") || p.endsWith(".mdx")) return "markdown";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".sh") || p.endsWith(".bash") || p.endsWith(".zsh")) return "shell";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".toml")) return "toml";
  if (p.endsWith(".css") || p.endsWith(".scss")) return "css";
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".sql")) return "sql";
  return "plaintext";
}

function base(path: string) {
  return String(path || "").split("/").filter(Boolean).pop() || path;
}

function parseProblems(text: string) {
  const out: any[] = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    let m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
    if (m) { out.push({ file: m[1], line: Number(m[2]), severity: "error", message: `${m[4]} ${m[5]}` }); continue; }
    m = line.match(/^(.+?):(\d+):(?:(\d+):)?\s*(error|warning|failed|FAIL|E)\b:?\s*(.*)$/i);
    if (m) out.push({ file: m[1], line: Number(m[2]), severity: m[4].toLowerCase(), message: m[5] || line });
  }
  return out.slice(0, 400);
}

function symbols(text: string) {
  const out: any[] = [];
  const rules = [
    [/^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*export\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_$]+)/, "class"],
    [/^\s*const\s+([A-Za-z0-9_$]+)\s*=/, "const"],
    [/^\s*def\s+([A-Za-z0-9_]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_]+)/, "class"],
    [/^\s*#{1,6}\s+(.+)/, "section"],
  ];
  String(text || "").split(/\r?\n/).forEach((line, i) => {
    for (const [re, kind] of rules) {
      const m = line.match(re as RegExp);
      if (m) { out.push({ line: i + 1, kind, name: m[1] }); break; }
    }
  });
  return out.slice(0, 300);
}

function importsOf(text: string) {
  return String(text || "").split(/\r?\n/).map((line, i) => ({ line: i + 1, text: line }))
    .filter((x) => /^\s*(import|from\s+\S+\s+import|const\s+\S+\s*=\s*require|#include)/.test(x.text))
    .slice(0, 300);
}

function makeDiff(original: string, current: string) {
  if (original === current) return "No patch.";
  const a = String(original || "").split(/\r?\n/);
  const b = String(current || "").split(/\r?\n/);
  const out = ["--- saved", "+++ current"];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < 800; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) out.push(`-${String(i + 1).padStart(4, " ")} ${a[i]}`);
      if (b[i] !== undefined) out.push(`+${String(i + 1).padStart(4, " ")} ${b[i]}`);
    }
  }
  return out.join("\n");
}

export default function PortfolioWorkbenchV18() {
  const [root, setRoot] = useState("");
  const [roots, setRoots] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [buffers, setBuffers] = useState<any>({});
  const [open, setOpen] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [left, setLeft] = useState("workspaces");
  const [right, setRight] = useState("inspector");
  const [bottom, setBottom] = useState("terminal");
  const [query, setQuery] = useState("");
  const [cmd, setCmd] = useState("pnpm run build || npm run build || pytest -q");
  const [terminal, setTerminal] = useState("Pick a workspace, tool, source file, or command.\n");
  const [activity, setActivity] = useState<string[]>([]);
  const [palette, setPalette] = useState(false);
  const [paletteQ, setPaletteQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeGenerated, setIncludeGenerated] = useState(false);
  const editorRef = useRef<any>(null);

  const log = useCallback((line: string) => {
    const stamped = `${new Date().toLocaleTimeString()}  ${line}`;
    setActivity((x) => [stamped, ...x].slice(0, 300));
  }, []);

  const refresh = useCallback(async (payload: any = {}) => {
    setBusy(true);
    try {
      const res = await api().state({ root: payload.root || root || undefined, includeGenerated });
      if (!res?.ok) throw new Error(res?.error || "state_failed");
      setRoot(res.root);
      setRoots(res.roots || []);
      setFiles(res.files || []);
      setTools(res.tools || []);
      log(`INDEX ${res.root} files=${res.files?.length || 0} tools=${res.tools?.length || 0} roots=${res.roots?.length || 0}`);
    } catch (e) {
      log(`STATE FAILED ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [root, includeGenerated, log]);

  useEffect(() => { void refresh({}); }, []);

  const selectRoot = useCallback(async (r: any) => {
    setBusy(true);
    try {
      const res = await api().selectRoot({ root: r.path, includeGenerated });
      if (!res?.ok) throw new Error(res?.error || "select_failed");
      setRoot(res.root);
      setRoots(res.roots || []);
      setFiles(res.files || []);
      setTools(res.tools || []);
      setOpen([]);
      setSelected("");
      setBuffers({});
      setTerminal(`$ switch-root ${res.root}\nstatus=live files=${res.files?.length || 0} tools=${res.tools?.length || 0}\n`);
      log(`ROOT ${res.root}`);
    } catch (e) {
      log(`ROOT FAILED ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [includeGenerated, log]);

  const discover = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api().discover({});
      if (!res?.ok) throw new Error(res?.error || "discover_failed");
      setRoots(res.roots || []);
      setLeft("workspaces");
      log(`DISCOVER roots=${res.roots?.length || 0}`);
    } catch (e) {
      log(`DISCOVER FAILED ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [log]);

  const openFolder = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api().openFolder({});
      if (!res?.ok) throw new Error(res?.error || "open_folder_failed");
      setRoot(res.root);
      setRoots(res.roots || []);
      setFiles(res.files || []);
      setTools(res.tools || []);
      setOpen([]);
      setSelected("");
      setBuffers({});
      log(`OPEN FOLDER ${res.root}`);
    } catch (e) {
      log(`OPEN FOLDER FAILED ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [log]);

  const openFile = useCallback(async (path: string) => {
    setBusy(true);
    try {
      const res = await api().read({ root, path });
      if (!res?.ok) throw new Error(res?.error || "read_failed");
      setBuffers((b: any) => ({ ...b, [path]: { path, original: res.content, content: res.content, dirty: false, language: lang(path) } }));
      setOpen((o) => Array.from(new Set([...o, path])));
      setSelected(path);
      log(`OPEN ${path}`);
    } catch (e) {
      log(`OPEN FAILED ${path} ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [root, log]);

  const saveCurrent = useCallback(async () => {
    const b = buffers[selected];
    if (!b) return;
    setBusy(true);
    try {
      const res = await api().write({ root, path: selected, content: b.content });
      if (!res?.ok) throw new Error(res?.error || "write_failed");
      setBuffers((x: any) => ({ ...x, [selected]: { ...b, original: b.content, dirty: false } }));
      log(`SAVE ${selected}`);
    } catch (e) {
      log(`SAVE FAILED ${selected} ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [root, selected, buffers, log]);

  const saveAll = useCallback(async () => {
    for (const p of Object.keys(buffers)) {
      if (!buffers[p]?.dirty) continue;
      const res = await api().write({ root, path: p, content: buffers[p].content });
      if (res?.ok) {
        setBuffers((x: any) => ({ ...x, [p]: { ...x[p], original: x[p].content, dirty: false } }));
        log(`SAVE ${p}`);
      } else {
        log(`SAVE FAILED ${p} ${res?.error}`);
      }
    }
  }, [root, buffers, log]);

  const run = useCallback(async (command = cmd) => {
    setBusy(true);
    setBottom("terminal");
    setTerminal(`$ ${command}\n`);
    try {
      const res = await api().run({ root, command, timeoutMs: 300000 });
      const text = [
        `$ ${command}`,
        `status=${res.status} exit=${res.exitCode} duration=${res.durationMs}ms cwd=${res.root}`,
        "",
        res.stdout || "",
        res.stderr ? "\n[stderr]\n" + res.stderr : "",
      ].join("\n");
      setTerminal(text);
      setBottom(res.exitCode === 0 ? "terminal" : "problems");
      log(`RUN ${res.status} ${command}`);
    } catch (e) {
      setTerminal(`$ ${command}\nFAILED ${String(e)}`);
      setBottom("problems");
      log(`RUN FAILED ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [root, cmd, log]);

  const writeAgent = useCallback(async () => {
    const b = buffers[selected];
    const body = [
      "# ADJUTORIX Portfolio Agent Context",
      "",
      `marker=${MARKER}`,
      `root=${root}`,
      `current=${selected || "none"}`,
      `dirty=${Object.values(buffers).filter((x: any) => x.dirty).map((x: any) => x.path).join(",") || "none"}`,
      "",
      "## Workspaces",
      ...roots.slice(0, 80).map((r) => `- ${r.name}: ${r.path} [${(r.markers || []).join(",")}]`),
      "",
      "## Tools",
      ...tools.slice(0, 200).map((t) => `- [${t.lane}] ${t.label}: ${t.command}`),
      "",
      "## Current Buffer",
      "",
      "```",
      b?.content?.slice(0, 40000) || "",
      "```",
      "",
      "## Activity",
      ...activity.slice(0, 120),
    ].join("\n");
    const res = await api().write({ root, path: ".adjutorix/portfolio-agent-context.md", content: body });
    log(res?.ok ? "AGENT CONTEXT WRITTEN .adjutorix/portfolio-agent-context.md" : `AGENT FAILED ${res?.error}`);
    setRight("agent");
  }, [root, roots, tools, buffers, selected, activity, log]);

  const current = buffers[selected];
  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files || []).filter((f) => !q || f.path.toLowerCase().includes(q) || f.kind.toLowerCase().includes(q));
  }, [files, query]);

  const visibleTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tools || []).filter((t) => !q || t.label.toLowerCase().includes(q) || t.command.toLowerCase().includes(q) || t.lane.toLowerCase().includes(q));
  }, [tools, query]);

  const outline = useMemo(() => symbols(current?.content || ""), [current]);
  const imps = useMemo(() => importsOf(current?.content || ""), [current]);
  const problems = useMemo(() => parseProblems(terminal), [terminal]);
  const patch = useMemo(() => current ? makeDiff(current.original, current.content) : "No file.", [current]);
  const dirty = useMemo(() => Object.values(buffers).filter((x: any) => x.dirty).length, [buffers]);

  const coreOpen = useCallback(async () => {
    const picks = visibleFiles.filter((f) =>
      /(^README\.md$|package\.json$|pyproject\.toml$|pnpm-workspace\.yaml$|src\/main|src\/preload|src\/renderer|main\.ts$|index\.ts$|index\.tsx$)/i.test(f.path)
    ).slice(0, 12);
    for (const f of picks) await openFile(f.path);
  }, [visibleFiles, openFile]);

  const paletteItems = useMemo(() => {
    const rootsItems = roots.map((r) => ({ label: `root: ${r.name}`, kind: "workspace", run: () => selectRoot(r) }));
    const toolItems = tools.map((t) => ({ label: t.label, kind: t.lane, run: () => { setCmd(t.command); run(t.command); } }));
    const fileItems = visibleFiles.slice(0, 500).map((f) => ({ label: f.path, kind: f.kind, run: () => openFile(f.path) }));
    const all = [...rootsItems, ...toolItems, ...fileItems];
    const q = paletteQ.trim().toLowerCase();
    return q ? all.filter((x) => x.label.toLowerCase().includes(q) || x.kind.toLowerCase().includes(q)) : all;
  }, [roots, tools, visibleFiles, paletteQ, selectRoot, run, openFile]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") { e.preventDefault(); setPalette(true); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveCurrent(); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); void saveAll(); }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [saveCurrent, saveAll]);

  const leftContent = () => {
    if (left === "workspaces") return <div className="v18-list">
      {roots.map((r) => <button key={r.path} className={r.path === root ? "v18-card active" : "v18-card"} onClick={() => selectRoot(r)}>
        <b>{r.name}</b><em>{(r.markers || []).join(" · ")}</em><code>{r.path}</code>
      </button>)}
    </div>;

    if (left === "tools" || left === "tasks" || left === "scm") return <div className="v18-list">
      {visibleTools.filter((t) => left !== "scm" || t.lane === "scm").map((t) => <button key={t.id} className="v18-card" onClick={() => { setCmd(t.command); run(t.command); }}>
        <b>{t.label}</b><em>{t.lane}</em><code>{t.command}</code>
      </button>)}
    </div>;

    if (left === "agent") return <div className="v18-agent">
      <textarea defaultValue={"Inspect selected workspace. Use all portfolio tools. Produce next patch. Run build, verify, tests, gates."} />
      <button onClick={writeAgent}>Write full portfolio context pack</button>
      <pre>{activity.join("\n")}</pre>
    </div>;

    if (left === "runtime") return <div className="v18-list">
      <button className="v18-card" onClick={discover}><b>Discover portfolio roots</b><code>scan parent folders</code></button>
      <button className="v18-card" onClick={() => refresh({})}><b>Index active root</b><code>{root}</code></button>
      <button className="v18-card" onClick={coreOpen}><b>Open core product surfaces</b><code>README/package/src/config</code></button>
      <button className="v18-card" onClick={writeAgent}><b>Write agent context</b><code>.adjutorix/portfolio-agent-context.md</code></button>
    </div>;

    return <div className="v18-list">
      {visibleFiles.map((f) => <button key={f.path} className={selected === f.path ? "v18-file active" : "v18-file"} onClick={() => openFile(f.path)}>
        <span>{buffers[f.path]?.dirty ? "●" : "·"}</span><b>{f.path}</b><em>{f.kind}</em>
      </button>)}
    </div>;
  };

  const rightContent = () => {
    if (right === "outline") return <div className="v18-cards">{outline.map((s) => <button key={`${s.line}-${s.name}`} onClick={() => editorRef.current?.revealLineInCenter?.(s.line)}><b>{s.kind}</b><span>{s.name}</span><em>line {s.line}</em></button>)}</div>;
    if (right === "problems") return <div className="v18-cards">{problems.length ? problems.map((p, i) => <button key={i} onClick={() => p.file && openFile(p.file)}><b className="bad">{p.severity}</b><span>{p.file}:{p.line}</span><em>{p.message}</em></button>) : <p>No parsed problems.</p>}</div>;
    if (right === "patch") return <pre className="v18-pre">{patch}</pre>;
    if (right === "graph") return <pre className="v18-pre">{[
      "WORKSPACES",
      ...roots.slice(0, 120).map((r) => `${r.name} :: ${r.path}`),
      "",
      "IMPORTS",
      ...imps.map((x) => `${x.line}: ${x.text}`),
      "",
      "SYMBOLS",
      ...outline.map((x) => `${x.line}: ${x.kind} ${x.name}`),
    ].join("\n")}</pre>;
    if (right === "agent") return <pre className="v18-pre">{activity.join("\n")}</pre>;

    return <div className="v18-inspector">
      <article><span>root</span><b>{root || "none"}</b></article>
      <section>
        <div><span>workspaces</span><b>{roots.length}</b></div>
        <div><span>files</span><b>{files.length}</b></div>
        <div><span>tools</span><b>{tools.length}</b></div>
        <div><span>open</span><b>{open.length}</b></div>
        <div><span>dirty</span><b>{dirty}</b></div>
        <div><span>status</span><b>{busy ? "busy" : "live"}</b></div>
      </section>
      <article><span>current</span><b>{selected || "none"}</b></article>
      <article><span>lanes</span><p>{Array.from(new Set(tools.map((t) => t.lane))).join(", ")}</p></article>
    </div>;
  };

  return <div className="v18">
    <header className="v18-top">
      <button className="v18-marker" onClick={() => setLeft("workspaces")}>{MARKER}</button>
      <button className="v18-palette-button" onClick={() => setPalette(true)}>⌘P</button>
      <div className="v18-root">{root}</div>
      <label className="v18-check"><input type="checkbox" checked={includeGenerated} onChange={(e) => setIncludeGenerated(e.target.checked)} /> generated</label>
      <button className="v18-live">{busy ? "BUSY" : "LIVE"}</button>
      <button onClick={openFolder}>Open folder</button>
      <button onClick={discover}>Discover</button>
      <button onClick={() => refresh({})}>Index</button>
      <button onClick={coreOpen}>Core</button>
      <button disabled={!current?.dirty} onClick={saveCurrent}>Save</button>
      <button disabled={!dirty} onClick={saveAll}>Save all</button>
    </header>

    <main className="v18-main">
      <nav className="v18-rail">
        {[
          ["workspaces", "WS"], ["explorer", "EX"], ["tools", "TL"], ["tasks", "TK"],
          ["scm", "SC"], ["agent", "AG"], ["runtime", "RT"],
        ].map(([id, label]) => <button key={id} className={left === id ? "active" : ""} onClick={() => setLeft(id)}>{label}</button>)}
      </nav>

      <aside className="v18-left">
        <div className="v18-left-head">
          <b>{left}</b><span>{left === "workspaces" ? roots.length : left === "tools" || left === "tasks" || left === "scm" ? visibleTools.length : visibleFiles.length}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="workspace, tool, file, module, buffer" />
        </div>
        {leftContent()}
      </aside>

      <section className="v18-center">
        <div className="v18-tabs">
          {open.length ? open.map((p) => <button key={p} className={selected === p ? "active" : ""} onClick={() => setSelected(p)}>{base(p)} {buffers[p]?.dirty ? "●" : ""}</button>) : <span>Open a source file.</span>}
        </div>
        <div className="v18-editor">
          {current ? <Editor
            height="100%"
            theme="vs-dark"
            path={`${root}/${current.path}`}
            language={current.language}
            value={current.content}
            onMount={(ed) => { editorRef.current = ed; }}
            options={{ automaticLayout: true, fontSize: 14, minimap: { enabled: true }, scrollBeyondLastLine: false, wordWrap: "off", renderWhitespace: "selection" }}
            onChange={(value) => {
              const next = value || "";
              setBuffers((b: any) => ({ ...b, [selected]: { ...b[selected], content: next, dirty: next !== b[selected].original } }));
            }}
          /> : <div className="v18-empty">No file selected.</div>}
        </div>
        <div className="v18-bottom">
          <div className="v18-bottom-tabs">{["terminal", "output", "problems", "patch", "graph", "raw"].map((x) => <button key={x} className={bottom === x ? "active" : ""} onClick={() => setBottom(x)}>{x}</button>)}</div>
          {bottom === "terminal" && <div className="v18-terminal">
            <div className="v18-runline"><input value={cmd} onChange={(e) => setCmd(e.target.value)} /><button onClick={() => run(cmd)}>Run</button></div>
            <pre>{terminal}</pre>
          </div>}
          {bottom === "output" && <pre className="v18-pre">{activity.join("\n")}</pre>}
          {bottom === "problems" && <pre className="v18-pre">{problems.length ? problems.map((p) => `${p.severity} ${p.file}:${p.line} ${p.message}`).join("\n") : "No parsed problems."}</pre>}
          {bottom === "patch" && <pre className="v18-pre">{patch}</pre>}
          {bottom === "graph" && <pre className="v18-pre">{rightContent() as any}</pre>}
          {bottom === "raw" && <pre className="v18-pre">{JSON.stringify({ root, roots, files: files.slice(0, 50), tools: tools.slice(0, 80), open, selected }, null, 2)}</pre>}
        </div>
      </section>

      <aside className="v18-right">
        <div className="v18-right-tabs">{["inspector", "outline", "problems", "patch", "graph", "agent"].map((x) => <button key={x} className={right === x ? "active" : ""} onClick={() => setRight(x)}>{x}</button>)}</div>
        {rightContent()}
      </aside>
    </main>

    {palette && <div className="v18-overlay" onMouseDown={() => setPalette(false)}>
      <div className="v18-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus value={paletteQ} onChange={(e) => setPaletteQ(e.target.value)} placeholder="workspace, command, task, file..." />
        <div>{paletteItems.slice(0, 80).map((item, i) => <button key={`${item.kind}-${item.label}-${i}`} onClick={() => { item.run(); setPalette(false); }}>
          <span>{item.label}</span><em>{item.kind}</em>
        </button>)}</div>
      </div>
    </div>}
  </div>;
}
