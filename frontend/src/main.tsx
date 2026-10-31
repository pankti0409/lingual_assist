import "@fontsource-variable/fraunces";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/atkinson-hyperlegible/400-italic.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/pages.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createDefaultServices } from "./api/ServicesProvider";
import { installVisibilityClass } from "./lib/dom";
import { createAppRouter } from "./router";

installVisibilityClass();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App services={createDefaultServices()} router={createAppRouter()} />
  </StrictMode>,
);
