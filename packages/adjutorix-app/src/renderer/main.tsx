import React from "react";
import { createRoot } from "react-dom/client";
import RevolutionWorkbench from "./RevolutionWorkbench";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RevolutionWorkbench />
  </React.StrictMode>,
);
