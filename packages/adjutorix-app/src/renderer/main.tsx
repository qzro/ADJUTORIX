import React from "react";
import { createRoot } from "react-dom/client";
import { AdjutorixPowerWorkbench } from "./components/AdjutorixPowerWorkbench";
import "./styles/adjutorix-power-workbench.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Adjutorix renderer root element was not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AdjutorixPowerWorkbench />
  </React.StrictMode>,
);
