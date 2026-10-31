// Renders all web media from the React SVG art sources (src/art/*):
//   art-source/*.svg            standalone SVG source for every still (preserved)
//   public/media/*.webp|.avif   stills, posters, portraits, state art, vignettes
//   public/media/hero-{wide,tall}.{mp4,webm}   silent 16 s seamless loops (16:9 and 4:5)
//   public/media/hero-captions.vtt
// Usage: npm run media            (needs Chrome and ffmpeg on PATH)
//        npm run media -- --stills-only
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, openPiece, startServer } from "./lib.mjs";

const OUT = "public/media";
const SRC = "art-source";
const FPS = 24;
const DURATION = 16; // must match HERO_DURATION in src/art/HeroFilm.tsx
const stillsOnly = process.argv.includes("--stills-only");

// name, piece, layout, t, width, height, scale
const STILLS = [
  ["scene-hero", "film", "wide", 0.8, 1600, 900, 1],
  ["scene-partner-asks", "film", "wide", 3.0, 1600, 900, 1],
  ["scene-listening", "film", "wide", 5.3, 1600, 900, 1],
  ["scene-context", "film", "wide", 6.6, 1600, 900, 1],
  ["scene-gesture", "film", "wide", 7.9, 1600, 900, 1],
  ["scene-combine", "film", "wide", 8.95, 1600, 900, 1],
  ["scene-candidates", "film", "wide", 10.9, 1600, 900, 1],
  ["scene-confirm", "film", "wide", 12.1, 1600, 900, 1],
  ["scene-speak", "film", "wide", 13.7, 1600, 900, 1],
  ["hero-poster-wide", "film", "wide", 13.7, 1600, 900, 1.2],
  ["hero-poster-tall", "film", "tall", 13.7, 800, 1000, 1],
  ["portrait-voice", "portrait-voice", "wide", 0.3, 800, 800, 1],
  ["portrait-gesture", "portrait-gesture", "wide", 0, 800, 800, 1],
  ["state-empty", "state-empty", "wide", 0, 800, 600, 1],
  ["state-unavailable", "state-unavailable", "wide", 0, 800, 600, 1],
  ["vignette-family", "vignette-family", "wide", 1, 800, 600, 1],
  ["vignette-friends", "vignette-friends", "wide", 1, 800, 600, 1],
  ["vignette-caregiving", "vignette-caregiving", "wide", 1, 800, 600, 1],
  ["vignette-work", "vignette-work", "wide", 1, 800, 600, 1],
  ["vignette-appointment", "vignette-appointment", "wide", 1, 800, 600, 1],
];

const VIDEOS = [
  ["hero-wide", "wide", 1600, 900],
  ["hero-tall", "tall", 800, 1000],
];

const CAPTIONS = `WEBVTT

00:00:01.200 --> 00:00:05.800
Partner: Would you like water or tea?

00:00:03.800 --> 00:00:06.200
[The patient answers, partly heard: "wa… water"]

00:00:06.000 --> 00:00:09.400
[Recent conversation is noted. A thumbs-up is held steady: "yes"]

00:00:08.500 --> 00:00:09.600
[Speech, gesture and context are combined]

00:00:09.700 --> 00:00:12.400
[Three replies are suggested. The patient chooses "I would like water, please."]

00:00:12.600 --> 00:00:15.000
Spoken, as confirmed: I would like water, please.
`;

function ff(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function encodeStill(png, name) {
  ff(["-i", png, "-c:v", "libwebp", "-quality", "84", "-compression_level", "6", join(OUT, `${name}.webp`)]);
  ff(["-i", png, "-c:v", "libaom-av1", "-still-picture", "1", "-crf", "30", "-b:v", "0", "-cpu-used", "4", "-pix_fmt", "yuv444p", join(OUT, `${name}.avif`)]);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(SRC, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "lingual-media-"));
const { server, origin } = await startServer();
const browser = await launch();

try {
  for (const [name, piece, layout, t, w, h, scale] of STILLS) {
    const page = await openPiece(browser, origin, { piece, layout, t, w, h, scale });
    const svg = await page.$eval("#stage", (el) => el.innerHTML);
    writeFileSync(join(SRC, `${name}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`);
    const png = join(tmp, `${name}.png`);
    await page.screenshot({ path: png });
    await page.close();
    encodeStill(png, name);
    console.log("still", name);
  }

  if (!stillsOnly) {
    for (const [name, layout, w, h] of VIDEOS) {
      const dir = join(tmp, name);
      mkdirSync(dir);
      const page = await openPiece(browser, origin, { piece: "film", layout, t: 0, w, h });
      const frames = DURATION * FPS;
      for (let i = 0; i < frames; i++) {
        await page.evaluate((tt) => window.__setT(tt), i / FPS);
        await page.screenshot({ path: join(dir, `f${String(i).padStart(4, "0")}.png`) });
      }
      await page.close();
      const input = ["-framerate", String(FPS), "-i", join(dir, "f%04d.png")];
      ff([...input, "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", join(OUT, `${name}.mp4`)]);
      ff([...input, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p", "-an", join(OUT, `${name}.webm`)]);
      console.log("video", name, `${frames} frames`);
    }
    writeFileSync(join(OUT, "hero-captions.vtt"), CAPTIONS);
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
}
