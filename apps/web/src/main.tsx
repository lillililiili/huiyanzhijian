import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/tokens.css";
import "./ui/components.css";
import "./styles/styles.css";
import "./styles/core.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("缺少 #root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
