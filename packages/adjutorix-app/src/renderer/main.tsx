import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import RevolutionWorkbench from "./RevolutionWorkbench";

const root = document.getElementById("root");

if (!root) {
  throw new Error("renderer_root_missing");
}

createRoot(root).render(
  <React.StrictMode>
    <RevolutionWorkbench />
  </React.StrictMode>,
);
