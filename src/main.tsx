import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { SessionProvider } from "./lib/auth";
import { FirmProvider } from "./lib/firm";
import { ThemeProvider, applyTheme, readStoredTheme } from "./lib/theme";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container is missing from index.html.");

// Applied before React mounts so a dark-mode user never sees a white flash.
applyTheme(readStoredTheme());

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <FirmProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </FirmProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
