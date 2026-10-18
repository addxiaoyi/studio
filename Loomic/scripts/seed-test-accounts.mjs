#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const sql = await readFile(new URL("./dev-seed-accounts.sql", import.meta.url), "utf8");
const container = process.env.HELSTERA_POSTGRES_CONTAINER ?? "helstera-postgres";

const child = spawn("docker", [
  "exec", "-i", container,
  "psql", "-U", "postgres", "-d", "helstera", "-v", "ON_ERROR_STOP=1",
], { stdio: ["pipe", "inherit", "inherit"] });

child.stdin.end(sql);
child.on("exit", (code) => process.exit(code ?? 1));
