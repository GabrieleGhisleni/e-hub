import "@ehub/ui/fonts";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setExploreStore } from "@ehub/explore";
import { setNotesStore } from "@ehub/notes";
import { ThemeProvider } from "@ehub/ui";
import { App } from "./App";
import { createAppExploreStore } from "./explore-data";
import { createAppNotesStore } from "./notes-data";

setNotesStore(createAppNotesStore());
setExploreStore(createAppExploreStore());

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
