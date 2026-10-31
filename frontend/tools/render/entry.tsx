/** Tooling-only page: renders one art piece at a given time so headless Chrome can capture it. */
import "@fontsource-variable/fraunces";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ART_PIECES } from "../../src/art/pieces";

declare global {
  interface Window {
    __setT: (t: number) => void;
    __ready: boolean;
  }
}

const q = new URLSearchParams(location.search);
const piece = q.get("piece") ?? "film";
const layout = (q.get("layout") ?? "wide") as "wide" | "tall";
const w = Number(q.get("w") ?? 1600);
const h = Number(q.get("h") ?? 900);
const stage = document.getElementById("stage")!;
stage.style.width = `${w}px`;
stage.style.height = `${h}px`;

let setter: (t: number) => void = () => undefined;
function App() {
  const [t, setT] = useState(Number(q.get("t") ?? 0));
  setter = setT;
  const Piece = ART_PIECES[piece];
  return <Piece t={t} layout={layout} />;
}

const root = createRoot(stage);
flushSync(() => root.render(<App />));
window.__setT = (t: number) => flushSync(() => setter(t));
document.fonts.ready.then(() => {
  window.__ready = true;
});
