import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "node_modules", "@ffmpeg", "core", "dist", "umd");
const targetDir = path.join(root, "public", "ffmpeg");

const assets = ["ffmpeg-core.js", "ffmpeg-core.wasm"];
for (const asset of assets) {
  const source = path.join(sourceDir, asset);
  if (!existsSync(source)) {
    throw new Error(`FFmpeg asset não encontrado: ${source}`);
  }
}

mkdirSync(targetDir, { recursive: true });
for (const asset of assets) {
  copyFileSync(path.join(sourceDir, asset), path.join(targetDir, asset));
}

console.log("FFmpeg web assets preparados.");
