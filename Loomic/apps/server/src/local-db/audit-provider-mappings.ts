import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ skipped: true, reason: "DATABASE_URL is not configured", duplicateModels: [] }));
  process.exit(0);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query("select lower(pm.model_id) as model_id, count(*)::int as mappings, count(*) filter (where pc.enabled and pc.health_status='healthy' and pm.enabled and pm.health_status <> 'unhealthy' and pm.failure_count < 3 and (pm.cooldown_until is null or pm.cooldown_until <= now()))::int as callable, string_agg(distinct pc.label, ' | ') as labels from provider_models pm join provider_configs pc on pc.id = pm.provider_id where pm.media_type in ('image','video') group by lower(pm.model_id) having count(*) > 1 order by count(*) desc, lower(pm.model_id)");
  console.log(JSON.stringify({ duplicateModels: rows }, null, 2));
} finally {
  await db.end();
}
