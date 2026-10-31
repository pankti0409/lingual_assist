// Drives the real app through the main flows in headless Chrome and saves screenshots:
// sample session -> suggestions -> review -> confirm -> play; expressions sheet; voice studio; progress.
// Fails on console errors. Usage: node tools/walkthrough.mjs <out-dir>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, startServer } from "./lib.mjs";

const out = process.argv[2] ?? "walkthrough";
mkdirSync(out, { recursive: true });
const { server, origin } = await startServer();
const browser = await launch();
const errors = [];

async function clickText(page, selector, text) {
  const handle = await page.waitForFunction(
    (sel, t) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim().toLowerCase().includes(t.toLowerCase()) && !el.disabled),
    { timeout: 10000 },
    selector,
    text,
  );
  await handle.asElement().click();
}

const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`), fullPage: false });

for (const [width, height, tag] of [
  [1440, 1000, "desk"],
  [390, 844, "phone"],
]) {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  await page.setViewport({ width, height });

  await page.goto(`${origin}/conversation?scenario=water`, { waitUntil: "networkidle0" });
  await clickText(page, "button", "Try the sample by typing");
  await clickText(page, "button", "Add patient message");
  await page.waitForSelector(".reply-list");
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, `${tag}-talk-suggestions`);
  await page.evaluate(() => document.querySelector(".studio-panel")?.scrollIntoView({ block: "start" }));
  await shot(page, `${tag}-talk-suggestions-panel`);
  await clickText(page, ".reply", "I would like water");
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, `${tag}-talk-review`);
  await clickText(page, "button", "Confirm these exact words");
  await page.waitForSelector(".confirmed-card");
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector(".studio-panel")?.scrollIntoView({ block: "start" }));
  await shot(page, `${tag}-talk-confirmed`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => [...document.querySelectorAll(`a[href="/expressions"]`)].find((a) => a.offsetParent)?.click());
  await page.waitForSelector(".board-grid");
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, `${tag}-expressions`);
  await clickText(page, ".xtile__main", "Thank you.");
  await page.waitForSelector(".dialog");
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, `${tag}-expression-sheet`);
  await clickText(page, ".dialog button", "Confirm these exact words");
  await page.waitForSelector(".sheet-confirmed");
  await new Promise((r) => setTimeout(r, 700));
  await shot(page, `${tag}-expression-confirmed`);
  await page.keyboard.press("Escape");

  for (const path of ["/voice", "/journey", "/settings", "/"]) {
    await page.goto(`${origin}${path}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, `${tag}-${path === "/" ? "home" : path.slice(1)}`);
  }
  await page.close();
}

await browser.close();
await server.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("walkthrough OK");
