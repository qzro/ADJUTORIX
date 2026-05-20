import React from "react";
import { createRoot } from "react-dom/client";
import PortfolioWorkbenchV18 from "./PortfolioWorkbenchV18";
import "./native-workbench.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PortfolioWorkbenchV18 />
  </React.StrictMode>
);
