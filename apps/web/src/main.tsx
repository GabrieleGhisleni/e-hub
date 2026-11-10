import "@ehub/ui/fonts";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setNotesStore } from "@ehub/notes";
import { ThemeProvider } from "@ehub/ui";
import { App } from "./App";
import { createAppNotesStore } from "./notes-data";

setNotesStore(createAppNotesStore());

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
