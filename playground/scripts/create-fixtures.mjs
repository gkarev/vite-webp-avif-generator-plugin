import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fixtures = [
  { path: "src/img/initial-pass/fresh.png", color: "#e74c3c", label: "fresh" },
  { path: "src/img/initial-pass/fresh-alt.jpeg", color: "#3498db", label: "jpeg" },
  {
    path: "src/img/already-converted/skip.png",
    color: "#2ecc71",
    label: "skip",
    withDerivatives: true
  },
  { path: "src/img/nested/deep/nested.png", color: "#9b59b6", label: "nested" },
  { path: "src/img/webp-source/photo.webp", color: "#f39c12", label: "webp", format: "webp" },
  { path: "src/img/excluded/should-not-convert.png", color: "#1abc9c", label: "excluded" },
  { path: "src/img/unsupported/ignore.gif", color: "#95a5a6", label: "gif", format: "gif" },
  { path: "src/img/generated-loop/loop.png", color: "#34495e", label: "loop", withDerivatives: true },
  { path: "src/img/live-add/.gitkeep", color: null },
  { path: "public/img/initial-pass/public-fresh.jpg", color: "#e67e22", label: "public" },
  { path: "public/img/excluded/public-excluded.png", color: "#16a085", label: "pub-excl" },
  { path: "public/img/nested/public-nested.png", color: "#8e44ad", label: "pub-nest" }
];

async function createImage(filePath, color, label, format = "png") {
  const fullPath = resolve(root, filePath);
  await mkdir(dirname(fullPath), { recursive: true });

  if (filePath.endsWith(".gitkeep")) {
    await writeFile(fullPath, "");
    return;
  }

  const width = 120;
  const height = 80;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="14" font-family="sans-serif">${label}</text>
  </svg>`;

  let pipeline = sharp(Buffer.from(svg));

  if (format === "webp") {
    await pipeline.webp().toFile(fullPath);
    return;
  }

  if (format === "gif") {
    await pipeline.gif().toFile(fullPath);
    return;
  }

  if (filePath.endsWith(".jpeg") || filePath.endsWith(".jpg")) {
    await pipeline.jpeg().toFile(fullPath);
    return;
  }

  await pipeline.png().toFile(fullPath);
}

async function createDerivatives(basePath) {
  const fullPath = resolve(root, basePath);
  const webpPath = fullPath.replace(/\.(png|jpe?g)$/i, ".webp");
  const avifPath = fullPath.replace(/\.(png|jpe?g)$/i, ".avif");

  await sharp(fullPath).webp().toFile(webpPath);
  await sharp(fullPath).avif().toFile(avifPath);
}

for (const fixture of fixtures) {
  if (fixture.color === null) {
    await createImage(fixture.path, null);
    continue;
  }

  await createImage(fixture.path, fixture.color, fixture.label, fixture.format);

  if (fixture.withDerivatives) {
    await createDerivatives(fixture.path);
  }
}

console.log("Fixtures created in playground/");
