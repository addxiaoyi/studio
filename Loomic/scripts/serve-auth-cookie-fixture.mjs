import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requireDesktop = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const { build } = await import(
  pathToFileURL(
    join(
      dirname(requireDesktop.resolve("vite/package.json")),
      "dist/node/index.js",
    ),
  ).href
);
const directory = await mkdtemp(
  join(tmpdir(), "helstera-auth-cookie-browser-"),
);
const pending = new Map();
const events = [];
let holdSession = false;
let holdLogout = false;
let sequence = 0;

function reply(response, status, body, cookie) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...(cookie ? { "set-cookie": cookie } : {}),
  });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function cookieUser(request) {
  return (
    request.headers.cookie?.match(
      /(?:^|;\s*)helstera_session=fixture-(old|fresh|latest)(?:;|$)/,
    )?.[1] ?? null
  );
}
function session(user) {
  return user
    ? {
        access_token: "local-session",
        user: { id: user, email: `${user}@example.test` },
      }
    : null;
}
function postpone(kind, response, finish) {
  const id = ++sequence;
  pending.set(id, { kind, response, finish });
  response.once("close", () => {
    events.push({ kind, id, event: "closed" });
  });
  events.push({ kind, id, event: "held" });
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? "/", "http://localhost:3001").pathname;
    if (path === "/__control__/state") {
      reply(response, 200, {
        events,
        pending: [...pending].map(([id, entry]) => ({ id, kind: entry.kind })),
      });
      return;
    }
    if (request.method === "POST" && path === "/__control__/hold-session") {
      holdSession = true;
      reply(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && path === "/__control__/hold-logout") {
      holdLogout = true;
      reply(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && path.startsWith("/__control__/release/")) {
      const id = Number(path.split("/").at(-1));
      const entry = pending.get(id);
      if (!entry) {
        reply(response, 404, { error: "Unknown held request" });
        return;
      }
      pending.delete(id);
      entry.finish();
      events.push({ kind: entry.kind, id, event: "released" });
      reply(response, 200, { ok: true });
      return;
    }
    if (path === "/api/local-auth/session") {
      const user = cookieUser(request);
      events.push({ kind: "session", event: "received", user });
      const finish = () => reply(response, 200, { session: session(user) });
      if (holdSession) {
        holdSession = false;
        postpone("session", response, finish);
      } else finish();
      return;
    }
    if (request.method === "POST" && path === "/api/local-auth/password") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const user = /^(old|fresh|latest)@example\.test$/.exec(
        payload.email,
      )?.[1];
      if (!user) {
        reply(response, 400, { error: "Invalid fixture identity" });
        return;
      }
      events.push({ kind: "login", event: "completed", user });
      reply(
        response,
        200,
        session(user),
        `helstera_session=fixture-${user}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`,
      );
      return;
    }
    if (request.method === "POST" && path === "/api/local-auth/sign-out") {
      events.push({
        kind: "logout",
        event: "received",
        user: cookieUser(request),
      });
      const finish = () =>
        reply(
          response,
          204,
          undefined,
          "helstera_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
        );
      if (holdLogout) {
        holdLogout = false;
        postpone("logout", response, finish);
      } else finish();
      return;
    }
    if (path === "/harness.js") {
      response.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      });
      response.end(await readFile(join(directory, "harness.js")));
      return;
    }
    if (path === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        '<!doctype html><html lang="en"><title>Cookie ordering fixture</title><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>',
      );
      return;
    }
    reply(response, 404, { error: "Unknown fixture route" });
  } catch (error) {
    console.error("[auth-cookie-fixture]", error);
    if (!response.headersSent)
      reply(response, 500, { error: "Fixture request failed" });
    else response.end();
  }
});

await build({
  configFile: false,
  define: {
    "process.env.NEXT_PUBLIC_SERVER_BASE_URL": '""',
    "process.env.NODE_ENV": '"production"',
  },
  esbuild: { jsx: "automatic" },
  build: {
    outDir: directory,
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(
        new URL(
          "../apps/web/e2e/helpers/auth-cookie-harness.tsx",
          import.meta.url,
        ),
      ),
      formats: ["es"],
      fileName: () => "harness.js",
    },
  },
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(3001, "127.0.0.1", resolve);
});
console.log("AUTH_COOKIE_FIXTURE_READY http://localhost:3001");

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const entry of pending.values()) entry.response.destroy();
  pending.clear();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
