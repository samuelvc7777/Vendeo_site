import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
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
  const sourcePath = path.join(sourceDir, asset);
  const targetPath = path.join(targetDir, asset);
  try {
    if (existsSync(targetPath)) {
      const sourceStat = statSync(sourcePath);
      const targetStat = statSync(targetPath);
      if (sourceStat.size === targetStat.size) {
        continue;
      }
    }
    copyFileSync(sourcePath, targetPath);
  } catch (err) {
    if (existsSync(targetPath)) {
      console.warn(`Aviso: não foi possível regravar ${asset} (${err?.code || err}), mas o arquivo já existe.`);
    } else {
      throw err;
    }
  }
}

console.log("FFmpeg web assets preparados.");
