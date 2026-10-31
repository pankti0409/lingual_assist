// Shared helpers for media tooling: a Vite dev server + headless system Chrome.
import { existsSync } from "node:fs";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export function chromePath() {
  const p = CHROME_CANDIDATES.find((c) => existsSync(c));
  if (!p) throw new Error("Chrome not found; set CHROME_PATH");
  return p;
}

export async function startServer() {
  const server = await createServer({ configFile: "vite.config.ts", server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const addr = server.httpServer.address();
  return { server, origin: `http://127.0.0.1:${addr.port}` };
}

export async function launch() {
  return puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
}

export async function openPiece(browser, origin, { piece, layout = "wide", w, h, t = 0, scale = 1 }) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await page.goto(`${origin}/render.html?piece=${piece}&layout=${layout}&w=${w}&h=${h}&t=${t}`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__ready === true", { timeout: 60000 });
  return page;
}
