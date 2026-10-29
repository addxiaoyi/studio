// @vitest-environment node
// Recomputes the WCAG 2 contrast of the design tokens straight out of
// `src/app/globals.css` — no hand-copied numbers. If a token value drifts,
// this test fails and prints the ratio it actually measured.
//
// Colour science: oklch -> oklab -> linear sRGB (Ottosson's matrices),
// relative luminance per WCAG 2.x (0.2126 R + 0.7152 G + 0.0722 B on
// linearised channels), contrast = (L1 + 0.05) / (L2 + 0.05).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, "../src/app/globals.css");
const css = readFileSync(cssPath, "utf8");

const AA_TEXT = 4.5;
const AA_UI = 3;
const MIN_TARGET = 24; // WCAG 2.2 SC 2.5.8

type Block = "light" | "dark";
type Rgb = [number, number, number];

function block(name: Block): string {
  const selector = name === "light" ? ":root" : ".dark";
  const start = new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m").exec(css);
  if (!start) throw new Error(`theme block ${selector} not found in globals.css`);
  const from = start.index + start[0].length;
  const end = css.indexOf("}", from);
  if (end < 0) throw new Error(`theme block ${selector} is unterminated`);
  return css.slice(from, end);
}

function tokenMap(name: Block): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of block(name).matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(decl[1]!, decl[2]!.trim());
  }
  return map;
}

function rawToken(name: Block, token: string): string {
  const map = tokenMap(name);
  const seen = new Set<string>();
  let current = token.replace(/^--/, "");
  let value = map.get(current);
  // Follow `var(--other)` aliases (e.g. dark --warning-strong: var(--warning)).
  while (value && /^var\(\s*--[a-z0-9-]+\s*\)$/.test(value)) {
    if (seen.has(current)) throw new Error(`circular token alias at --${current}`);
    seen.add(current);
    current = /--([a-z0-9-]+)/.exec(value)![1]!;
    value = map.get(current);
  }
  if (!value) throw new Error(`--${current} is not defined in the ${name} theme`);
  return value;
}

function parseOklch(value: string): [number, number, number] {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*\)$/.exec(value);
  if (!m) throw new Error(`expected a plain oklch() colour, got: ${value}`);
  const num = (text: string): number =>
    text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
  return [num(m[1]!), num(m[2]!), num(m[3]!)];
}

/** oklch -> linear sRGB (channels clamped to the gamut). */
function oklchToLinear([L, C, hDeg]: [number, number, number]): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const lPrime = L + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = L - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(fg: string, bg: string): number {
  const a = relativeLuminance(oklchToLinear(parseOklch(fg)));
  const b = relativeLuminance(oklchToLinear(parseOklch(bg)));
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

function ratio(theme: Block, fg: string, bg: string): number {
  return contrast(rawToken(theme, fg), rawToken(theme, bg));
}

const round = (n: number): number => Math.round(n * 100) / 100;

function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`rule ${selector} not found in globals.css`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("CSS design tokens — WCAG contrast", () => {
  it("defines --destructive-foreground in both themes so the red banner has real ink", () => {
    expect(tokenMap("light").has("destructive-foreground")).toBe(true);
    expect(tokenMap("dark").has("destructive-foreground")).toBe(true);
  });

  it("--destructive-foreground reaches AA on the --destructive surface in both themes", () => {
    const light = round(ratio("light", "--destructive-foreground", "--destructive"));
    const dark = round(ratio("dark", "--destructive-foreground", "--destructive"));
    // eslint-disable-next-line no-console
    console.log(`--destructive-foreground on --destructive  light=${light}:1  dark=${dark}:1`);
    expect(light).toBeGreaterThanOrEqual(AA_TEXT);
    expect(dark).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("semantic status colours stay AA as text on --background and --card", () => {
    const rows: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      for (const token of ["--destructive", "--success", "--warning-strong"]) {
        for (const surface of ["--background", "--card"]) {
          const value = round(ratio(theme, token, surface));
          rows.push(`${theme.padEnd(5)} ${token.padEnd(18)} on ${surface.padEnd(12)} ${value}:1`);
          expect(value).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(rows.join("\n"));
  });

  it("leaves no #b42318 / #21845b / #a75b2b literals behind", () => {
    for (const hex of ["#b42318", "#21845b", "#a75b2b"]) {
      expect(css.toLowerCase().includes(hex)).toBe(false);
    }
  });
});

describe("Desktop toast — WCAG 2.2 SC 2.5.8 and viewport containment", () => {
  it("gives the dismiss button a target of at least 24x24 CSS px", () => {
    const body = ruleBody(".desktop-toast__dismiss");
    const width = Number(/(?:^|;)\s*width:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
    const height = Number(/(?:^|;)\s*height:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
    const minWidth = Number(/(?:^|;)\s*min-width:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
    const minHeight = Number(/(?:^|;)\s*min-height:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
    const resolvedWidth = Math.max(width, minWidth);
    const resolvedHeight = Math.max(height, minHeight);
    // eslint-disable-next-line no-console
    console.log(`.desktop-toast__dismiss target ${resolvedWidth}x${resolvedHeight}`);
    expect(resolvedWidth).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(resolvedHeight).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it("keeps the toast stack inside a short viewport and scrollable", () => {
    const body = ruleBody(".desktop-toast-viewport");
    expect(body).toMatch(/max-height:\s*calc\(100vh\s*-\s*96px\)/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it("keeps the dismiss glyph small enough for the enlarged padding to be cosmetically neutral", () => {
    const icon = ruleBody(".desktop-toast__dismiss svg");
    expect(icon).toMatch(/width:\s*14px/);
  });
});

describe("Focus ring / non-text contrast sanity", () => {
  it("--ring stays visible against --background (>= 3:1 UI contrast)", () => {
    for (const theme of ["light", "dark"] as const) {
      const value = round(ratio(theme, "--ring", "--background"));
      // eslint-disable-next-line no-console
      console.log(`--ring on --background ${theme.padEnd(5)} ${value}:1`);
      expect(value).toBeGreaterThanOrEqual(AA_UI);
    }
  });
});
