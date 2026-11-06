import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginBuilder } from "bun";

export function registerPinnedSourceResolver(build: PluginBuilder, source: string) {
  const packages = new Map<string, { directory: string; exports: Record<string, string | Record<string, string>> }>();
  for (const name of readdirSync(join(source, "packages"))) {
    const directory = join(source, "packages", name);
    const manifestPath = join(directory, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    packages.set(manifest.name, { directory, exports: manifest.exports ?? {} });
  }
  build.onResolve({ filter: /^(?:@remotion\/[^/]+|remotion)(?:\/.*)?$/ }, args => {
    const name = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : "remotion";
    const pkg = packages.get(name);
    if (!pkg) return;
    const exported = pkg.exports[args.path === name ? "." : `.${args.path.slice(name.length)}`];
    const target = typeof exported === "string" ? exported : exported?.module ?? exported?.import ?? exported?.default;
    if (!target) throw new Error(`No pinned source export for ${args.path}`);
    const base = target.replace(/^\.\/dist\/(?:esm\/|cjs\/)?/, "src/").replace(/\.(?:mjs|js)$/, "");
    const path = [base + ".ts", base + ".tsx", base + ".js", base + ".jsx", base, target]
      .map(file => join(pkg.directory, file)).find(file => existsSync(file));
    if (!path) throw new Error(`Cannot resolve pinned source ${args.path}`);
    return { path };
  });
  build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: Bun.resolveSync(args.path, join(source, "packages/studio")) }));
}
