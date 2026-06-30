import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/adjutorix-power-workbench.css";

type BootState = {
  error: Error | null;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function FatalRenderer({ error }: { error: unknown }): JSX.Element {
  return (
    <main className="adjutorix-renderer-fatal" data-adjutorix-renderer-failure-marker="ADJUTORIX_RENDERER_FAILURE">
      <section>
        <p>ADJUTORIX RENDERER FAILURE</p>
        <h1>The app is alive, but the workbench failed to mount.</h1>
        <pre>{messageFrom(error)}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload Adjutorix
        </button>
      </section>
    </main>
  );
}

class AdjutorixBootBoundary extends React.Component<React.PropsWithChildren, BootState> {
  public state: BootState = { error: null };

  public static getDerivedStateFromError(error: Error): BootState {
    return { error };
  }

  public componentDidCatch(error: Error): void {
    document.documentElement.dataset.adjutorixRendererFailure = error.message;
    console.error("ADJUTORIX_RENDERER_BOUNDARY_CAUGHT", error);
  }

  public render(): React.ReactNode {
    if (this.state.error) {
      return <FatalRenderer error={this.state.error} />;
    }

    return this.props.children;
  }
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById("root");

  if (!root) {
    root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
  }

  return root;
}

function renderFatal(error: unknown): void {
  const root = ensureRoot();
  root.innerHTML = "";
  createRoot(root).render(<FatalRenderer error={error} />);
}

async function mountAdjutorix(): Promise<void> {
  document.documentElement.dataset.adjutorixRendererBoot = "started";

  window.addEventListener("error", (event) => {
    document.documentElement.dataset.adjutorixRendererFailure = event.message;
    console.error("ADJUTORIX_WINDOW_ERROR", event.message, event.error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = messageFrom(event.reason);
    document.documentElement.dataset.adjutorixRendererFailure = reason;
    console.error("ADJUTORIX_UNHANDLED_REJECTION", event.reason);
  });

  const root = ensureRoot();

  root.innerHTML = `
    <main class="adjutorix-html-boot">
      <section>
        <p>ADJUTORIX HARD BOOT</p>
        <h1>Workbench loading…</h1>
        <span>React is loading the real Adjutorix workbench.</span>
      </section>
    </main>
  `;

  const { default: App } = await import("./App");

  root.innerHTML = "";

  createRoot(root).render(
    <React.StrictMode>
      <AdjutorixBootBoundary>
        <App />
      </AdjutorixBootBoundary>
    </React.StrictMode>,
  );

  document.documentElement.dataset.adjutorixRendererBoot = "mounted";
  console.log("ADJUTORIX_RENDERER_BOOT_MOUNTED");
}

void mountAdjutorix().catch((error) => {
  document.documentElement.dataset.adjutorixRendererFailure = messageFrom(error);
  console.error("ADJUTORIX_RENDERER_BOOT_FAILED", error);
  renderFatal(error);
});
