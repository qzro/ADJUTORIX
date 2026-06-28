// @ts-nocheck
import React from "react";
import { createRoot } from "react-dom/client";
import LocalOperatorCockpit from "./components/LocalOperatorCockpit";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/app.css";

function FatalRenderer(props: { message: string }): JSX.Element {
  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
      <section className="mx-auto max-w-3xl rounded-3xl border border-red-500/40 bg-red-950/30 p-6">
        <div className="text-xs uppercase tracking-[0.24em] text-red-300">Renderer mount failed</div>
        <h1 className="mt-3 text-2xl font-semibold">ADJUTORIX could not mount the operator cockpit.</h1>
        <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-red-500/30 bg-black/40 p-4 text-sm text-red-100">
          {props.message}
        </pre>
      </section>
    </div>
  );
}

function mount(): void {
  const container = document.getElementById("root");

  if (!container) {
    throw new Error("renderer_root_container_missing");
  }

  const root = createRoot(container);

  try {
    root.render(
      <React.StrictMode>
        <LocalOperatorCockpit />
      </React.StrictMode>,
    );
  } catch (error) {
    root.render(
      <React.StrictMode>
        <FatalRenderer message={error instanceof Error ? error.message : String(error)} />
      </React.StrictMode>,
    );
  }
}

mount();
