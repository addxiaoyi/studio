import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TREE_ITEMS = 4_000;
const MAX_TREE_DEPTH = 8;
const MAX_COMMAND_OUTPUT = 256_000;
const COMMAND_TIMEOUT_MS = 5 * 60_000;
const IGNORED_DIRECTORIES = new Set([".git", ".next", ".turbo", ".helstera", "build", "coverage", "dist", "node_modules", "out", "vendor"]);
const SECRET_FILE = /(^\.env(?:\.|$)|^\.ssh$|^\.aws$|^\.azure$|^\.kube$|^\.docker$|\.pem$|\.p12$|\.pfx$|\.key$|\.pypirc$|\.npmrc$|\.netrc$|(^|\.)secrets?(\.|$)|credentials?\.json$|id_(rsa|ed25519|ecdsa|dsa)$)/i;
const SCRIPT_NAME = /^(test|build|typecheck|lint|check)(:[a-z0-9:_-]+)?$/i;

export type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size?: number };
export type WorkspaceScript = { name: string; manager: "pnpm" | "npm" | "yarn" };
type SnapshotManifest = { id: string; path: string; existed: boolean; createdAt: string };

function isInside(root: string, target: string) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function safeRelativePath(path: string) {
  if (!path || path.includes("\0") || isAbsolute(path)) throw new Error("Choose a path inside the selected project.");
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Project paths cannot contain traversal segments.");
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part.toLowerCase()))) throw new Error("Generated, dependency, and version-control directories are excluded from direct file access.");
  if (parts.some((part) => SECRET_FILE.test(part))) throw new Error("Credential and secret files are excluded from the local Agent workspace.");
  return parts.join(sep);
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => {
    if (!value || /key|token|secret|password|credential|cookie|auth/i.test(key)) return false;
    return ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "LANG", "TERM", "CI"].includes(key);
  }));
}

export class LocalWorkspace {
  readonly root: string;
  private readonly snapshotsRoot: string;
  private readonly running = new Map<string, ChildProcess>();

  private constructor(root: string, snapshotsRoot: string) {
    this.root = root;
    this.snapshotsRoot = snapshotsRoot;
  }

  static async open(rootPath: string, snapshotsRoot: string) {
    const root = await realpath(rootPath);
    if (!(await lstat(root)).isDirectory()) throw new Error("Choose a project folder.");
    await mkdir(snapshotsRoot, { recursive: true });
    return new LocalWorkspace(root, snapshotsRoot);
  }

  async tree(): Promise<WorkspaceEntry[]> {
    const entries: WorkspaceEntry[] = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_TREE_DEPTH || entries.length >= MAX_TREE_ITEMS) return;
      const children = await readdir(directory, { withFileTypes: true });
      for (const child of children) {
        if (entries.length >= MAX_TREE_ITEMS) return;
        if (child.name.startsWith(".") && child.name !== ".github") continue;
        if (child.isSymbolicLink() || (child.isDirectory() && IGNORED_DIRECTORIES.has(child.name))) continue;
        const absolute = join(directory, child.name);
        const path = relative(this.root, absolute);
        if (path.split(sep).some((part) => SECRET_FILE.test(part))) continue;
        if (child.isDirectory()) {
          entries.push({ name: child.name, path, kind: "directory" });
          await walk(absolute, depth + 1);
        } else if (child.isFile()) {
          entries.push({ name: child.name, path, kind: "file", size: (await lstat(absolute)).size });
        }
      }
    };
    await walk(this.root, 0);
    return entries;
  }

  async read(path: string) {
    const target = await this.resolveExisting(path);
    const info = await lstat(target);
    if (!info.isFile()) throw new Error("Only regular text files can be opened.");
    if (info.size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES} byte editor limit.`);
    const content = await readFile(target);
    if (content.includes(0)) throw new Error("Binary files cannot be opened in the text editor.");
    return { path: relative(this.root, target), content: content.toString("utf8"), size: info.size };
  }

  async write(path: string, content: string) {
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Files are limited to ${MAX_FILE_BYTES} bytes.`);
    const target = await this.resolveForWrite(path);
    const existed = await this.fileExists(target);
    const id = randomUUID();
    const directory = join(this.snapshotsRoot, id);
    await mkdir(directory, { recursive: true });
    if (existed) await copyFile(target, join(directory, "before"));
    const manifest: SnapshotManifest = { id, path: relative(this.root, target), existed, createdAt: new Date().toISOString() };
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest), { flag: "wx" });
    await writeFile(target, content, "utf8");
    return { path: manifest.path, snapshotId: id, bytes: Buffer.byteLength(content, "utf8") };
  }

  async restore(snapshotId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new Error("Invalid snapshot id.");
    const directory = join(this.snapshotsRoot, snapshotId);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as SnapshotManifest;
    if (manifest.id !== snapshotId) throw new Error("Snapshot manifest does not match its id.");
    const target = await this.resolveForWrite(manifest.path);
    if (manifest.existed) await copyFile(join(directory, "before"), target);
    else await rm(target, { force: true });
    await rm(directory, { recursive: true, force: true });
    return { path: manifest.path, restored: true };
  }

  async gitStatus() {
    return (await execFileAsync("git", ["-C", this.root, "status", "--short", "--branch"], { timeout: 10_000, maxBuffer: MAX_COMMAND_OUTPUT, env: cleanEnvironment() })).stdout;
  }

  async gitDiff(path?: string) {
    const args = ["-C", this.root, "diff", "--no-ext-diff", "--", ...(path ? [safeRelativePath(path)] : [])];
    return (await execFileAsync("git", args, { timeout: 15_000, maxBuffer: MAX_COMMAND_OUTPUT, env: cleanEnvironment() })).stdout;
  }

  async scripts(): Promise<WorkspaceScript[]> {
    let manifest: { scripts?: Record<string, unknown> };
    try { manifest = JSON.parse(await readFile(join(this.root, "package.json"), "utf8")) as typeof manifest; }
    catch { return []; }
    const manager = await this.packageManager();
    return Object.keys(manifest.scripts ?? {}).filter((name) => SCRIPT_NAME.test(name)).map((name) => ({ name, manager }));
  }

  async runScript(name: string, runId: string, onOutput: (chunk: string) => void, signal: AbortSignal) {
    const available = await this.scripts();
    if (!SCRIPT_NAME.test(name) || !available.some((script) => script.name === name)) throw new Error("Only declared test/build/check scripts can run automatically.");
    if (this.running.has(runId)) throw new Error("A command with this run id is already active.");
    const manager = available.find((script) => script.name === name)!.manager;
    const child = spawn(process.platform === "win32" ? `${manager}.cmd` : manager, ["run", name], {
      cwd: this.root,
      env: cleanEnvironment(),
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childEvents = child as unknown as EventEmitter;
    this.running.set(runId, child);
    return new Promise<{ exitCode: number }>((resolvePromise, rejectPromise) => {
      let outputBytes = 0;
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        this.running.delete(runId);
        signal.removeEventListener("abort", abort);
        return true;
      };
      const append = (chunk: Buffer) => {
        const part = chunk.subarray(0, Math.max(0, MAX_COMMAND_OUTPUT - outputBytes));
        outputBytes += part.length;
        if (part.length) onOutput(part.toString("utf8"));
      };
      const abort = () => { child.kill(); };
      const timeout = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      childEvents.once("error", (error: Error) => {
        if (!finish()) return;
        clearTimeout(timeout);
        rejectPromise(error);
      });
      childEvents.once("close", (code: number | null) => {
        if (!finish()) return;
        clearTimeout(timeout);
        if (signal.aborted) rejectPromise(new Error("Command canceled."));
        else if (code === 0) resolvePromise({ exitCode: 0 });
        else rejectPromise(new Error(`Script exited with code ${code ?? "unknown"}.`));
      });
    });
  }

  cancelScript(runId: string) {
    return this.running.get(runId)?.kill() ?? false;
  }

  private async packageManager(): Promise<WorkspaceScript["manager"]> {
    if (await this.fileExists(join(this.root, "pnpm-lock.yaml"))) return "pnpm";
    if (await this.fileExists(join(this.root, "yarn.lock"))) return "yarn";
    return "npm";
  }

  private async resolveExisting(path: string) {
    const target = await realpath(resolve(this.root, safeRelativePath(path)));
    if (!isInside(this.root, target)) throw new Error("Path resolves outside the selected project.");
    return target;
  }

  private async resolveForWrite(path: string) {
    const target = resolve(this.root, safeRelativePath(path));
    if (!isInside(this.root, target)) throw new Error("Path resolves outside the selected project.");
    const parent = await realpath(dirname(target));
    if (!isInside(this.root, parent)) throw new Error("Parent directory resolves outside the selected project.");
    const info = await lstat(target).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error("Writing through symbolic links is not allowed.");
    if (info && !info.isFile()) throw new Error("Only regular files can be edited.");
    return target;
  }

  private async fileExists(path: string) {
    try { await lstat(path); return true; } catch { return false; }
  }
}
