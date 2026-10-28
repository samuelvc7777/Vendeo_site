import { spawnSync } from "node:child_process";
import { lstatSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoutes = path.join(root, "src", "app", "api");
// O Tailwind ignora node_modules: rotas de servidor não entram no CSS estático.
const apiRoutesBackup = path.join(root, "node_modules", ".vendeo-static-api-routes-backup");
const devTypes = path.join(root, ".next", "dev", "types");
const devTypesBackup = path.join(root, ".next", "dev", "types-build-backup");

function pathExists(filename) {
  try {
    lstatSync(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function moveDirectory(source, destination, operation) {
  if (!pathExists(source)) {
    throw new Error(`${operation}: origem ausente em ${source}. Confira os diretórios antes de continuar.`);
  }
  if (pathExists(destination)) {
    throw new Error(`${operation}: destino já existe em ${destination}. Origem e destino não serão sobrescritos ou excluídos.`);
  }
  try {
    renameSync(source, destination);
  } catch (error) {
    throw new Error(`${operation}: rename falhou (${error.code || "erro desconhecido"}). Confira ${source} e ${destination}; nenhuma cópia ou exclusão será tentada.`, { cause: error });
  }
}

const preservedDirectories = [];
let buildExitCode = 1;

try {
  if (pathExists(apiRoutesBackup) || pathExists(devTypesBackup)) {
    throw new Error(`Já existe um backup temporário do build em ${apiRoutesBackup} ou ${devTypesBackup}. Confira os arquivos antes de continuar; nada será sobrescrito.`);
  }
  moveDirectory(apiRoutes, apiRoutesBackup, "Preservar src/app/api");
  preservedDirectories.push({ original: apiRoutes, temporary: apiRoutesBackup, label: "src/app/api" });
  if (pathExists(devTypes)) {
    moveDirectory(devTypes, devTypesBackup, "Preservar .next/dev/types");
    preservedDirectories.push({ original: devTypes, temporary: devTypesBackup, label: ".next/dev/types" });
  }

  const npmCli = process.env.npm_execpath;
  const isCmd = !npmCli && process.platform === "win32";
  const executable = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = npmCli ? [npmCli, "exec", "next", "build"] : ["exec", "next", "build"];
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", shell: isCmd });
  if (result.error) throw new Error(`Não foi possível iniciar o build: ${result.error.message}`, { cause: result.error });
  buildExitCode = result.status ?? 1;
  if (result.signal) console.error(`Build interrompido pelo sinal ${result.signal}.`);
} catch (error) {
  console.error(error.message);
  buildExitCode = 1;
} finally {
  // Uma restauração malsucedida não impede a tentativa das demais.
  // Destinos recriados durante o build e backups ficam intactos para revisão.
  for (const directory of preservedDirectories.reverse()) {
    try {
      moveDirectory(directory.temporary, directory.original, `Restaurar ${directory.label}`);
    } catch (error) {
      console.error(error.message);
      buildExitCode = 1;
    }
  }
}

process.exitCode = buildExitCode;
