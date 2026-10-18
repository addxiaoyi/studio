const MAX_CSV_BYTES = 2_000_000;
const MAX_ROWS = 500;

const aliases: Record<string, string> = {
  package_id: "packageId", packageid: "packageId", content_package_id: "packageId",
  plan_id: "planId", publishing_plan_id: "planId",
  variant_id: "variantId", platform: "platform", account_alias: "accountAlias", account: "accountAlias",
  post_url: "postUrl", url: "postUrl", published_at: "publishedAt",
  impressions: "impressions", views: "views", completions: "completions",
  likes: "likes", comments: "comments", shares: "shares", saves: "saves",
  clicks: "clicks", leads: "leads", conversions: "conversions",
  spend_cny: "spendCny", spend: "spendCny", revenue_cny: "revenueCny", revenue: "revenueCny",
};

const numericFields = new Set([
  "impressions", "views", "completions", "likes", "comments", "shares", "saves",
  "clicks", "leads", "conversions", "spendCny", "revenueCny",
]);

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) { values.push(value.trim()); value = ""; continue; }
    value += char;
  }
  values.push(value.trim());
  return values;
}

function parseValue(field: string, value: string): unknown {
  if (!value) return undefined;
  if (!numericFields.has(field)) return value;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) ? number : value;
}

export function parseMetricsCsv(input: Buffer | string): {
  records: Record<string, unknown>[];
  errors: Array<{ row: number; message: string }>;
  headers: string[];
} {
  const text = typeof input === "string" ? input : input.toString("utf8");
  if (Buffer.byteLength(text) > MAX_CSV_BYTES) throw new Error("CSV 文件不能超过 2MB");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV 至少需要一行表头和一行数据");
  if (lines.length - 1 > MAX_ROWS) throw new Error(`CSV 最多支持 ${MAX_ROWS} 行数据`);

  const sourceHeaders = parseLine(lines[0]!);
  const fields = sourceHeaders.map((header) => aliases[normalizeHeader(header)] ?? "");
  const errors: Array<{ row: number; message: string }> = [];
  const records: Record<string, unknown>[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = parseLine(lines[index]!);
    const record: Record<string, unknown> = {};
    let hasValue = false;
    values.forEach((value, column) => {
      const field = fields[column];
      if (!field) return;
      if (value) hasValue = true;
      const parsed = parseValue(field, value);
      if (parsed !== undefined) record[field] = parsed;
    });
    if (!hasValue) continue;
    record.rawSource = { source: "csv", row: index + 1, headers: sourceHeaders, values, normalized: { ...record } };
    if (!record.packageId || !record.platform || !record.accountAlias || !record.postUrl || !record.publishedAt) {
      errors.push({ row: index + 1, message: "缺少 package_id、platform、account_alias、post_url 或 published_at" });
      continue;
    }
    records.push(record);
  }
  return { records, errors, headers: sourceHeaders };
}