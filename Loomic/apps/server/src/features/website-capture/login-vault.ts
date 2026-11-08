import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { websiteLoginCredentialsSchema, type WebsiteLoginCredentials, type WebsiteLoginRef } from "@helstera/shared";

function vaultKey() {
  const key = Buffer.from(process.env.WEBSITE_LOGIN_ENCRYPTION_KEY ?? process.env.PROVIDER_CONFIG_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("网站登录暂不可用：服务端尚未配置凭据加密。");
  return key;
}
function binding(id: string, workspaceId: string, userId: string) {
  return Buffer.from(`website-login:v1:${id}:${workspaceId}:${userId}`);
}
export async function saveWebsiteLogin(db: Pool, workspaceId: string, userId: string, input: WebsiteLoginCredentials) {
  const { username, password, ...settings } = websiteLoginCredentialsSchema.parse(input);
  const id = randomUUID(), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(binding(id, workspaceId, userId));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ username, password }), "utf8"), cipher.final()]);
  const ciphertext = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  await purgeWebsiteLogins(db);
  await db.query("insert into website_login_secrets(id,workspace_id,user_id,settings,ciphertext) values($1,$2,$3,$4,$5)", [id, workspaceId, userId, settings, ciphertext]);
  return { ...settings, credentialId: id } satisfies WebsiteLoginRef;
}
export async function attachWebsiteLogin(db: Pool, workspaceId: string, userId: string, taskId: string, login: WebsiteLoginRef) {
  const { credentialId, ...settings } = login;
  const { rows } = await db.query(`update website_login_secrets set task_id=$4 where id=$1 and workspace_id=$2 and user_id=$3 and settings=$5::jsonb
    and (task_id=$4 or (task_id is null and ciphertext is not null and expires_at>now())) returning id`, [credentialId, workspaceId, userId, taskId, JSON.stringify(settings)]);
  if (!rows[0]) throw new Error("登录凭据已过期、已使用或不属于此任务，请重新填写。");
}
export async function assertWebsiteLoginReady(db: Pool, taskId: string) {
  const { rows } = await db.query(`select s.id from website_login_secrets s join website_capture_tasks t on t.id=s.task_id
    where t.id=$1 and s.id::text=t.login->>'credentialId' and s.workspace_id=t.workspace_id and s.user_id=t.created_by
    and s.settings=t.login-'credentialId' and s.ciphertext is not null and s.expires_at>now()`, [taskId]);
  if (!rows[0]) throw new Error("登录凭据已过期或已使用，请新建任务并重新填写。");
}
export async function consumeWebsiteLogin(db: Pool, taskId: string, workspaceId: string, userId: string, login: WebsiteLoginRef) {
  const { credentialId, ...settings } = login;
  // Consume before navigation so worker retries cannot silently reuse a password.
  const { rows } = await db.query<{ ciphertext: string }>(`with secret as (
    select id,ciphertext from website_login_secrets where id=$1 and task_id=$2 and workspace_id=$3 and user_id=$4
    and settings=$5::jsonb and ciphertext is not null and expires_at>now() for update
  ), consumed as (update website_login_secrets s set ciphertext=null,consumed_at=now() from secret where s.id=secret.id returning s.id)
  select secret.ciphertext from secret join consumed using(id)`, [credentialId, taskId, workspaceId, userId, JSON.stringify(settings)]);
  if (!rows[0]) throw new Error("登录凭据已过期或已使用，请新建任务并重新填写。");
  try {
    const bytes = Buffer.from(rows[0].ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", vaultKey(), bytes.subarray(0, 12));
    decipher.setAAD(binding(credentialId, workspaceId, userId));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return websiteLoginCredentialsSchema.parse({ ...settings, ...JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) });
  } catch { throw new Error("登录凭据无法解密，请重新填写。"); }
}
export async function discardWebsiteLogin(db: Pool, taskId: string) {
  await db.query("update website_login_secrets set ciphertext=null where task_id=$1 and ciphertext is not null", [taskId]);
}
export async function purgeWebsiteLogins(db: Pool) {
  await db.query("update website_login_secrets set ciphertext=null where expires_at<=now() and ciphertext is not null");
}
