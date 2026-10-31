// Loads every route at the required widths in headless Chrome and fails on:
//   - horizontal document overflow
//   - console errors / uncaught page errors / failed same-origin requests
// Also checks the home page with prefers-reduced-motion (no video element, story unpinned).
// Usage: npm run check:layout [-- --shots <dir>]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, startServer } from "./lib.mjs";

const WIDTHS = [390, 768, 1024, 1440, 1920];
const ROUTES = ["/", "/setup", "/conversation", "/conversation?scenario=ambiguous", "/expressions", "/voice", "/journey", "/settings", "/gestures", "/review", "/evaluation", "/screens", "/does-not-exist"];
const shotsIdx = process.argv.indexOf("--shots");
const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const { server, origin } = await startServer();
const browser = await launch();
const problems = [];
let checks = 0;

async function visit(path, width, { reduced = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => r.url().startsWith(origin) && errors.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => r.url().startsWith(origin) && r.status() >= 400 && errors.push(`http ${r.status()}: ${r.url()}`));
  await page.setViewport({ width, height: width < 700 ? 844 : 900 });
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(origin + path, { waitUntil: "networkidle0" });
  await page.waitForSelector("main h1", { timeout: 20000 });
  // scroll through the page to trigger lazy content and scroll-linked layout
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 700) await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 150));
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    if (over <= 1) return null;
    const culprits = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    return `${over}px (${culprits.join(", ")})`;
  });
  const extra = reduced ? await page.evaluate(() => ({ video: !!document.querySelector("video"), pinned: !!document.querySelector(".story--pinned") })) : null;
  checks++;
  if (overflow) problems.push(`${path} @${width}${reduced ? " reduced" : ""}: horizontal overflow ${overflow}`);
  errors.forEach((e) => problems.push(`${path} @${width}${reduced ? " reduced" : ""}: ${e}`));
  if (extra && (extra.video || extra.pinned)) problems.push(`${path} @${width} reduced: motion not disabled ${JSON.stringify(extra)}`);
  if (shots && [390, 1440].includes(width)) {
    const name = `${path.replace(/[/?=]/g, "_") || "_home"}-${width}${reduced ? "-reduced" : ""}.png`;
    await page.screenshot({ path: join(shots, name), fullPage: path === "/" ? false : true });
  }
  await page.close();
}

try {
  for (const path of ROUTES) for (const w of WIDTHS) await visit(path, w);
  for (const w of [390, 1440]) await visit("/", w, { reduced: true });
} finally {
  await browser.close();
  await server.close();
}

console.log(`${checks} page checks`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("OK: no horizontal overflow, console errors or failed requests");
