import React from "react";
import { createRoot } from "react-dom/client";
import RevolutionWorkbench from "./RevolutionWorkbench";
import "./styles/app.css";
import "./styles/layout.css";
import "./styles/theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("adjutorix_renderer_root_missing");

createRoot(root).render(
  <React.StrictMode>
    <RevolutionWorkbench />
  </React.StrictMode>,
);
