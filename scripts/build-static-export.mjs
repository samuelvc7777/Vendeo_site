import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoutes = path.join(root, "src", "app", "api");
const apiRoutesBackup = path.join(root, "src", ".build-api-routes-backup");
const devTypes = path.join(root, ".next", "dev", "types");
const devTypesBackup = path.join(root, ".next", "dev", "types-build-backup");

if (!existsSync(apiRoutes)) throw new Error("Pasta de rotas src/app/api não encontrada.");
if (existsSync(apiRoutesBackup) || existsSync(devTypesBackup)) {
  throw new Error("Já existe um backup temporário do build; confira os arquivos antes de continuar.");
}

let apiRoutesMoved = false;
let devTypesMoved = false;
let buildExitCode = 1;

try {
  renameSync(apiRoutes, apiRoutesBackup);
  apiRoutesMoved = true;
  if (existsSync(devTypes)) {
    renameSync(devTypes, devTypesBackup);
    devTypesMoved = true;
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
    renameSync(devTypesBackup, generatedDevTypes);
  }
  if (apiRoutesMoved && existsSync(apiRoutesBackup)) {
    if (existsSync(apiRoutes)) throw new Error("src/app/api foi recriada durante o build; backup preservado para recuperação.");
    renameSync(apiRoutesBackup, apiRoutes);
  }
}

process.exitCode = buildExitCode;
