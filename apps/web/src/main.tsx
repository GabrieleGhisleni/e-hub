import "./session"; // first: takes the login token and sets the admin flag before any module reads it
import "@ehub/ui/fonts";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHttpExploreStore, setExploreStore } from "@ehub/explore";
import { createHttpNotesStore, setNotesStore } from "@ehub/notes";
import { ThemeProvider } from "@ehub/ui";
import { App } from "./App";

setNotesStore(createHttpNotesStore());
setExploreStore(createHttpExploreStore());

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
