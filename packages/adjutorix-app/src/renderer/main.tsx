import React from "react";
import { createRoot } from "react-dom/client";
import CommandCenterWorkbench from "./CommandCenterWorkbench";
import "./native-workbench.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("ADJUTORIX_RENDERER_ROOT_MISSING");

createRoot(rootElement).render(
  <React.StrictMode>
    <CommandCenterWorkbench />
  </React.StrictMode>,
);
