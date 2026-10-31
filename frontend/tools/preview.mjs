// Quick visual check: node tools/preview.mjs <outDir> piece:layout:t:w:h ...
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, openPiece, startServer } from "./lib.mjs";

const [outDir, ...specs] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const { server, origin } = await startServer();
const browser = await launch();
try {
  for (const spec of specs) {
    const [piece, layout, t, w, h] = spec.split(":");
    const page = await openPiece(browser, origin, { piece, layout, t: Number(t), w: Number(w), h: Number(h) });
    const file = join(outDir, `${piece}-${layout}-${t}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
