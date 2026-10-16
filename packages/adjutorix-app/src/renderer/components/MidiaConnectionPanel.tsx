import React, { useCallback, useEffect, useRef, useState } from "react";

// Renderer receives narrow JSON IPC results; neither key, socket path nor
// execution capability is exported from Electron's main process.
type MidiaBridge = {
  status: () => Promise<any>;
  presentations: () => Promise<any>;
  bind: (sessionId: string) => Promise<any>;
  listing: (viewId: string) => Promise<any>;
  read: (viewId: string, path: string) => Promise<any>;
  workItems: () => Promise<any>;
  portfolio: (offset?: number, limit?: number) => Promise<any>;
};
const bridge = (): MidiaBridge | undefined =>
  (window as unknown as { adjutorixMidia?: MidiaBridge }).adjutorixMidia;

type Presented = { event_id: string; session_id: string; project: string; state: string };
type FileEntry = { path: string; name?: string };
const SID = /^s_[a-f0-9]{48}$/;

export default function MidiaConnectionPanel(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [reason, setReason] = useState("checking");
  const [presented, setPresented] = useState<Presented[]>([]);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [output, setOutput] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [grants, setGrants] = useState<Array<{project:string;state:string}>>([]);
  const [portfolio, setPortfolio] = useState<Array<{full_name:string;visibility:string;archived:boolean;midia_grant:string}>>([]);
  const [portfolioTotal, setPortfolioTotal] = useState(0);
  const [portfolioNext, setPortfolioNext] = useState<number | null>(null);
  const [portfolioStatus, setPortfolioStatus] = useState("Catalog not loaded");
  const selectionToken = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const client = bridge();
      if (!client) throw new Error("NATIVE_BRIDGE_NOT_INSTALLED");
      const health = await client.status();
      if (health?.ok !== true || health.connected !== true ||
          health.execution_authorized !== false) {
        throw new Error(String(health?.reason || "MIDIA_HEALTH_REFUSED"));
      }
      setConnected(true);
      setGrants(Array.isArray(health.grants) ? health.grants.filter((grant: any) =>
        typeof grant?.project === "string" && typeof grant?.state === "string")
        .map((grant: any) => ({project: grant.project, state: grant.state})).slice(0,32) : []);
      setReason("Authenticated local MIDIA-AI channel; execution remains owner-gated");
      const events = await client.presentations();
      setPresented(events?.ok === true && Array.isArray(events.presentations)
        ? events.presentations.filter((event: any) =>
            typeof event?.session_id === "string" && SID.test(event.session_id)).slice(0, 32)
        : []);
      const work = await client.workItems();
      setPendingCount(work?.ok && Array.isArray(work.items) ? work.items.length : 0);
      const inventory = await client.portfolio(0, 50);
      if (inventory?.ok === true && inventory.catalogue_available === true &&
          Array.isArray(inventory.repositories)) {
        setPortfolio(inventory.repositories);
        setPortfolioTotal(Number(inventory.repository_count) || 0);
        setPortfolioNext(typeof inventory.next_offset === "number" ? inventory.next_offset : null);
        setPortfolioStatus(inventory.catalog_complete ? "Inventoried metadata" : "Partial inventory — unavailable owners flagged");
      } else {
        setPortfolio([]); setPortfolioTotal(0); setPortfolioNext(null);
        setPortfolioStatus("MIDIA-AI portfolio catalogue pending owner discovery / gateway upgrade");
      }
    } catch (error) {
      setConnected(false);
      ++selectionToken.current;
      setGrants([]);
      setPortfolio([]); setPortfolioTotal(0); setPortfolioNext(null);
      setPresented([]);
      setView("");
      setSelected("");
      setFiles([]);
      setReason(error instanceof Error ? error.message.slice(0, 160) : "MIDIA_UNAVAILABLE");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 12000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const loadMorePortfolio = useCallback(async () => {
    if (portfolioNext === null) return;
    const client = bridge();
    if (!client) return;
    try {
      const result = await client.portfolio(portfolioNext, 50);
      if (result?.ok !== true || result.catalogue_available !== true ||
          !Array.isArray(result.repositories)) return;
      setPortfolio(previous => {
        const included = new Set(previous.map(entry => entry.full_name.toLowerCase()));
        return [...previous, ...result.repositories.filter((entry: any) => {
          if (typeof entry?.full_name !== 'string' || included.has(entry.full_name.toLowerCase())) return false;
          included.add(entry.full_name.toLowerCase());
          return true;
        })].slice(0, 4096);
      });
      setPortfolioNext(typeof result.next_offset === 'number' ? result.next_offset : null);
    } catch { /* Metadata-only listing failure does not invalidate the HMAC session. */ }
  }, [portfolioNext]);

  const selectSession = useCallback(async (event: Presented) => {
    if (!SID.test(event.session_id)) return;
    // Explicit ChatGPT session selection required: never auto-open a different chat.
    const currentRequest = ++selectionToken.current;
    setView("");
    setSelected("");
    setFiles([]);
    try {
      const client = bridge();
      if (!client) throw new Error("NATIVE_BRIDGE_UNAVAILABLE");
      const bound = await client.bind(event.session_id);
      if (currentRequest !== selectionToken.current) return;
      if (bound?.ok !== true || !/^view_[a-f0-9]{48}$/.test(bound.view_id)) {
        throw new Error(String(bound?.reason || "SESSION_BIND_REFUSED"));
      }
      const listed = await client.listing(bound.view_id);
      if (currentRequest !== selectionToken.current) return;
      if (listed?.ok !== true) throw new Error(String(listed?.reason || "LIST_REFUSED"));
      const data = listed.result || {};
      const entries = Array.isArray(data.entries) ? data.entries :
        Array.isArray(data.files) ? data.files : [];
      setView(bound.view_id);
      setSelected(event.project);
      setFiles(entries.filter((entry: any) => typeof entry?.path === "string").slice(0, 100));
      setOutput("Bound to " + event.project + ". Select a tracked source file.");
    } catch (error) {
      if (currentRequest !== selectionToken.current) return;
      setOutput("MIDIA SESSION REFUSED: " + (error instanceof Error ? error.message : String(error)));
    }
  }, []);

  const readFile = useCallback(async (filePath: string) => {
    if (!view || !filePath || filePath.length > 2048) return;
    const currentRequest = selectionToken.current;
    try {
      const client = bridge();
      if (!client) throw new Error("NATIVE_BRIDGE_UNAVAILABLE");
      const result = await client.read(view, filePath);
      if (currentRequest !== selectionToken.current) return;
      if (result?.ok !== true) throw new Error(String(result?.reason || "READ_REFUSED"));
      const source = String(result.source_sha256 || "unknown");
      const revision = String(result.head || "unknown");
      setOutput(("Source SHA-256: " + source + "\nGit HEAD: " + revision +
        "\n\n" + String(result.text || "")).slice(0, 32000));
    } catch (error) {
      setOutput("READ REFUSED: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [view]);

  return <section aria-label="MIDIA-AI connected source" data-testid="midia-native-connected-surface"
      style={{ padding: 12, border: "1px solid currentColor", borderRadius: 8, margin: 12 }}>
    <header><strong>MIDIA-AI · ADJUTORIX</strong> — {connected ? "Connected" : "Not connected"}</header>
    <p>{reason}</p>
    <small>Actual tracked source only · No unsaved buffers · No automatic command execution</small>
    <div><button type="button" onClick={() => { void refresh(); }}>Refresh projects</button></div>
    {connected ? <p>Authorized grants: {grants.length
      ? grants.map(grant => `${grant.project} (${grant.state})`).join(", ")
      : "No available grant details"}</p> : null}
    {connected ? <section aria-label="GitHub portfolio metadata only">
      <h3>GitHub portfolio · {portfolioTotal} repositories</h3>
      <small>{portfolioStatus}. Repository visibility does not grant MIDIA source access.</small>
      <div style={{maxHeight: 200, overflow: 'auto'}}>
        {portfolio.map(repo => <div key={repo.full_name}>
          <strong>{repo.full_name}</strong> · {repo.visibility}
          {repo.archived ? ' · archived' : ''} · {repo.midia_grant === 'SELECTED_SOURCE'
            ? 'selected source grant' : 'metadata only'}
        </div>)}
      </div>
      {portfolioNext !== null ? <button type="button" onClick={() => { void loadMorePortfolio(); }}>
        Load more repositories</button> : null}
    </section> : null}
    {connected && !presented.length ? <p>No ChatGPT-presented session is pending.
      Open the selected authorized project from MIDIA-AI in ChatGPT, then refresh here.</p> : null}
    {presented.length > 0 ? <p>Select the exact ChatGPT-presented project:</p> : null}
    {presented.map(item => <button key={item.event_id} type="button"
        onClick={() => { void selectSession(item); }}>
      {item.project} · {item.state}
    </button>)}
    {selected ? <h3>{selected} · tracked source</h3> : null}
    <div style={{ maxHeight: 180, overflow: "auto" }}>
      {files.map((file, i) => <button key={file.path + i} type="button"
          onClick={() => { void readFile(file.path); }}>{file.path}</button>)}
    </div>
    {pendingCount > 0 ? <p>{pendingCount} MIDIA work request(s) awaiting owner approval in governed workflow</p> : null}
    {output ? <pre style={{ maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>{output}</pre> : null}
  </section>;
}
