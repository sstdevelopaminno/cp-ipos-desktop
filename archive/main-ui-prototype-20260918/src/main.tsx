import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppNext from "./AppNext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppNext />
  </StrictMode>
);
