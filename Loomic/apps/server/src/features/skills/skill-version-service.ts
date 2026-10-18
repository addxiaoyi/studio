import type { Pool, PoolClient } from "pg";

export type SkillScriptAudit = {
  risk: "low" | "medium" | "high";
  scripts: number;
  capabilities: string[];
  findings: string[];
};

type SkillSnapshot = {
  name: string;
  description: string;
  author: string;
  version: string;
  license: string | null;
  category: string;
  iconName: string | null;
  skillContent: string;
  metadata: Record<string, unknown>;
  files: Array<{ filePath: string; content: string; mimeType: string }>;
};

export async function recordSkillVersion(
  db: Pool | PoolClient,
  input: { skillId: string; version: string; createdBy?: string | null; sourceUrl?: string | null },
) {
  const { rows } = await db.query<SkillSnapshot & { id: string }>(
    `select s.name, s.description, s.author, s.version, s.license, s.category,
            s.icon_name as "iconName", s.skill_content as "skillContent",
            s.metadata, coalesce(jsonb_agg(jsonb_build_object(
              'filePath', sf.file_path, 'content', sf.content, 'mimeType', sf.mime_type
            ) order by sf.file_path) filter (where sf.id is not null), '[]'::jsonb) as files
     from skills s
     left join skill_files sf on sf.skill_id = s.id
     where s.id = $1
     group by s.id`,
    [input.skillId],
  );
  const skill = rows[0];
  if (!skill) return null;

  const snapshot: SkillSnapshot = {
    ...skill,
    metadata: skill.metadata ?? {},
    files: skill.files ?? [],
  };
  const inserted = await db.query<{ id: string }>(
    `insert into skill_versions (skill_id, version, snapshot, source_url, created_by)
     values ($1, $2, $3::jsonb, $4, $5)
     on conflict (skill_id, version) do update set snapshot = excluded.snapshot,
       source_url = coalesce(excluded.source_url, skill_versions.source_url)
     returning id`,
    [input.skillId, input.version, JSON.stringify(snapshot), input.sourceUrl ?? null, input.createdBy ?? null],
  );
  return inserted.rows[0]?.id ?? null;
}

export function auditSkillScripts(files: Array<{ filePath: string; content: string }>): SkillScriptAudit {
  const scripts = files.filter((file) => /^scripts\//i.test(file.filePath));
  const text = scripts.map((file) => file.content).join("\n");
  const capabilities = new Set<string>();
  const findings: string[] = [];

  if (/\b(fetch|axios|httpx?|requests|curl|wget|socket|urllib)\b/i.test(text)) {
    capabilities.add("network");
    findings.push("脚本可能访问网络");
  }
  if (/\b(child_process|subprocess|os\.system|shell=True|exec\(|spawn\()\b/i.test(text) || scripts.some((file) => /\.(sh|bash|zsh)$/i.test(file.filePath))) {
    capabilities.add("shell");
    findings.push("脚本可能执行系统命令");
  }
  if (/\b(fs\.|readFile|writeFile|pathlib|open\(|os\.path|shutil)\b/i.test(text)) {
    capabilities.add("filesystem");
    findings.push("脚本可能读写工作区文件");
  }
  if (/\b(process\.env|os\.environ|dotenv|secret|api[_-]?key|token)\b/i.test(text)) {
    capabilities.add("secrets");
    findings.push("脚本可能读取环境变量或凭据");
  }

  const risk = capabilities.has("shell") && capabilities.has("secrets")
    ? "high"
    : capabilities.size >= 2
      ? "medium"
      : "low";
  return { risk, scripts: scripts.length, capabilities: [...capabilities], findings };
}
