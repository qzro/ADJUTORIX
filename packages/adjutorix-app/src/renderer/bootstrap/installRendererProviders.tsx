import React, { useEffect } from "react";

type RuntimeLike = Record<string, unknown>;

function exposeRuntime(runtime: RuntimeLike): void {
  const g = globalThis as Record<string, unknown>;
  g.__adjutorixRendererRuntime = runtime;
  g.adjutorixRuntime = runtime;

  const runtimeRecord = runtime as Record<string, unknown>;
  const bridge =
    (runtimeRecord.bridge as Record<string, unknown> | undefined) ??
    (runtimeRecord.api as Record<string, unknown> | undefined);

  if (bridge) {
    g.adjutorix = bridge;
  }
}

export function installRendererProviders(runtime: RuntimeLike) {
  exposeRuntime(runtime);

  return function InstalledRendererProviders(
    { children }: { children: React.ReactNode },
  ): React.JSX.Element {
    useEffect(() => {
      const g = globalThis as Record<string, unknown>;
      const prevRendererRuntime = g.__adjutorixRendererRuntime;
      const prevAdjutorixRuntime = g.adjutorixRuntime;
      const prevAdjutorix = g.adjutorix;

      exposeRuntime(runtime);

      return () => {
        if (prevRendererRuntime === undefined) delete g.__adjutorixRendererRuntime;
        else g.__adjutorixRendererRuntime = prevRendererRuntime;

        if (prevAdjutorixRuntime === undefined) delete g.adjutorixRuntime;
        else g.adjutorixRuntime = prevAdjutorixRuntime;

        if (prevAdjutorix === undefined) delete g.adjutorix;
        else g.adjutorix = prevAdjutorix;
      };
    }, []);

    return <>{children}</>;
  };
}

export default installRendererProviders;
