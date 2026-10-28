import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoutes = path.join(root, "src", "app", "api");
// O Tailwind ignora node_modules: rotas de servidor não entram no CSS estático.
const apiRoutesBackup = path.join(root, "node_modules", ".vendeo-static-api-routes-backup");
const devTypes = path.join(root, ".next", "dev", "types");
const devTypesBackup = path.join(root, ".next", "dev", "types-build-backup");

function moveDirWithFallback(src, dst) {
  try {
    renameSync(src, dst);
    return true;
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    if (process.platform !== "win32") {
      console.warn(`Aviso: não foi possível mover ${path.basename(src)} (EPERM), continuando sem backup...`);
      return false;
    }
    console.log(`renameSync falhou com EPERM; tentando robocopy /MOVE para ${path.basename(src)}...`);
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
    const result = spawnSync("robocopy", [src, dst, "/E", "/MOVE", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"], { stdio: "pipe" });
    if (!existsSync(dst)) {
      console.warn(`Aviso: robocopy também falhou para ${path.basename(src)}, continuando sem backup...`);
      return false;
    }
    // robocopy pode deixar a origem vazia mas existente; remove se estiver vazia
    try { rmSync(src, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    return true;
  }
}

function restoreDirWithFallback(src, dst) {
  try {
    renameSync(src, dst);
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    if (process.platform !== "win32") throw e;
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
    const result = spawnSync("robocopy", [src, dst, "/E", "/MOVE", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"], { stdio: "pipe" });
    if (!existsSync(dst)) throw new Error(`Falha ao restaurar ${path.basename(dst)} via robocopy`);
    try { rmSync(src, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
}

if (!existsSync(apiRoutes)) throw new Error("Pasta de rotas src/app/api não encontrada.");
if (existsSync(apiRoutesBackup) || existsSync(devTypesBackup)) {
  throw new Error("Já existe um backup temporário do build; confira os arquivos antes de continuar.");
}

let apiRoutesMoved = false;
let devTypesMoved = false;
let buildExitCode = 1;

try {
  apiRoutesMoved = moveDirWithFallback(apiRoutes, apiRoutesBackup);

  if (existsSync(devTypes)) {
    devTypesMoved = moveDirWithFallback(devTypes, devTypesBackup);
  }

  const npmCli = process.env.npm_execpath;
  const isCmd = !npmCli && process.platform === "win32";
  const executable = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = npmCli ? [npmCli, "exec", "next", "build"] : ["exec", "next", "build"];
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", shell: isCmd });
  buildExitCode = result.status ?? 1;
} finally {
  const generatedDevTypes = path.join(root, ".next", "dev", "types");
  if (devTypesMoved && existsSync(devTypesBackup)) {
    if (existsSync(generatedDevTypes)) rmSync(generatedDevTypes, { recursive: true, force: true });
    restoreDirWithFallback(devTypesBackup, generatedDevTypes);
  }
  if (apiRoutesMoved && existsSync(apiRoutesBackup)) {
    if (existsSync(apiRoutes)) throw new Error("src/app/api foi recriada durante o build; backup preservado para recuperação.");
    restoreDirWithFallback(apiRoutesBackup, apiRoutes);
  }
}

process.exitCode = buildExitCode;
