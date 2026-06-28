import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/adjutorix-power-workbench.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Adjutorix renderer root element was not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
