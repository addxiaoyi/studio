import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../supabase/user.js";
import type { BrandKitAsset, BrandKitAssetCreateRequest, BrandKitAssetUpdateRequest, BrandKitDetail, BrandKitSummary, BrandKitUpdateRequest } from "@helstera/shared";
import { BrandKitServiceError, type BrandKitService } from "../features/brand-kit/brand-kit-service.js";

export function createLocalBrandKitService(db: Pool, root = "/www/helstera/uploads") : BrandKitService {
  return {
    async listKits(user) {
      const { rows } = await db.query("select id, name, is_default, cover_url, created_at, updated_at from brand_kits where user_id = $1 order by created_at", [user.id]);
      return Promise.all(rows.map(async (kit) => ({ ...mapKitSummary(kit), asset_counts: await assetCounts(db, kit.id) })));
    },
    async getKit(user, kitId) { await assertKit(db, user.id, kitId); return loadKit(db, kitId); },
    async createKit(user, input) {
      const { rows } = await db.query("insert into brand_kits (user_id, name) values ($1, $2) returning *", [user.id, input.name?.trim() || "未命名"]);
      return loadKit(db, rows[0].id);
    },
    async updateKit(user, kitId, input: BrandKitUpdateRequest) {
      await assertKit(db, user.id, kitId);
      const values: unknown[] = []; const fields: string[] = [];
      for (const [key, value] of Object.entries(input)) { fields.push(`${key} = $${values.length + 1}`); values.push(value); }
      if (input.is_default) await db.query("update brand_kits set is_default = false where user_id = $1", [user.id]);
      if (fields.length) { values.push(kitId); await db.query(`update brand_kits set ${fields.join(", ")}, updated_at = now() where id = $${values.length}`, values); }
      return loadKit(db, kitId);
    },
    async deleteKit(user, kitId) { await assertKit(db, user.id, kitId); await db.query("delete from brand_kits where id = $1", [kitId]); },
    async createAsset(user, kitId, input: BrandKitAssetCreateRequest) { await assertKit(db, user.id, kitId); const { rows } = await db.query("insert into brand_kit_assets (kit_id, asset_type, display_name, role, text_content, metadata) values ($1,$2,$3,$4,$5,$6) returning *", [kitId, input.asset_type, input.display_name, input.role ?? null, input.text_content ?? null, input.metadata ?? {}]); return mapAsset(rows[0]); },
    async updateAsset(user, kitId, assetId, input: BrandKitAssetUpdateRequest) { await assertAsset(db, user.id, kitId, assetId); const values: unknown[] = []; const fields: string[] = []; for (const [key, value] of Object.entries(input)) { fields.push(`${key} = $${values.length + 1}`); values.push(value); } if (fields.length) { values.push(assetId, kitId); await db.query(`update brand_kit_assets set ${fields.join(", ")}, updated_at = now() where id = $${values.length - 1} and kit_id = $${values.length}`, values); } const { rows } = await db.query("select * from brand_kit_assets where id = $1", [assetId]); return mapAsset(rows[0]); },
    async deleteAsset(user, kitId, assetId) { await assertAsset(db, user.id, kitId, assetId); await db.query("delete from brand_kit_assets where id = $1", [assetId]); },
    async uploadAsset(user, kitId, assetType, fileName, buffer, mimeType) { await assertKit(db, user.id, kitId); const path = `brand-kits/${user.id}/${kitId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`; await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), buffer); return this.createAsset(user, kitId, { asset_type: assetType, display_name: fileName, text_content: null, role: null, metadata: { filePath: path, mimeType } }); },
    async duplicateKit(user, kitId) { const source = await loadKitForUser(db, user.id, kitId); const { rows } = await db.query("insert into brand_kits (user_id, name, guidance_text) values ($1,$2,$3) returning id", [user.id, `${source.name} Copy`, source.guidance_text]); for (const asset of source.assets) await db.query("insert into brand_kit_assets (kit_id, asset_type, display_name, role, sort_order, text_content, file_url, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8)", [rows[0].id, asset.asset_type, asset.display_name, asset.role, asset.sort_order, asset.text_content, asset.file_url, asset.metadata]); return loadKit(db, rows[0].id); },
  };
}

async function assertKit(db: Pool, userId: string, kitId: string) { if (!(await db.query("select 1 from brand_kits where id = $1 and user_id = $2", [kitId, userId])).rowCount) throw new BrandKitServiceError("brand_kit_not_found", "Brand kit not found.", 404); }
async function assertAsset(db: Pool, userId: string, kitId: string, assetId: string) { if (!(await db.query("select 1 from brand_kit_assets a join brand_kits k on k.id = a.kit_id where a.id = $1 and a.kit_id = $2 and k.user_id = $3", [assetId, kitId, userId])).rowCount) throw new BrandKitServiceError("brand_kit_asset_not_found", "Brand kit asset not found.", 404); }
async function loadKitForUser(db: Pool, userId: string, kitId: string) { await assertKit(db, userId, kitId); return loadKit(db, kitId); }
async function loadKit(db: Pool, kitId: string): Promise<BrandKitDetail> { const { rows } = await db.query("select * from brand_kits where id = $1", [kitId]); const kit = rows[0]; const assets = await db.query("select * from brand_kit_assets where kit_id = $1 order by sort_order, created_at", [kitId]); return { id: kit.id, name: kit.name, is_default: kit.is_default, guidance_text: kit.guidance_text, cover_url: kit.cover_url, created_at: kit.created_at.toISOString(), updated_at: kit.updated_at.toISOString(), assets: assets.rows.map(mapAsset) }; }
async function assetCounts(db: Pool, kitId: string) { const { rows } = await db.query("select asset_type, count(*)::int as count from brand_kit_assets where kit_id = $1 group by asset_type", [kitId]); const counts = { color: 0, font: 0, logo: 0, image: 0 }; for (const row of rows) counts[row.asset_type as keyof typeof counts] = row.count; return counts; }
function mapKitSummary(row: any): BrandKitSummary { return { id: row.id, name: row.name, is_default: row.is_default, cover_url: row.cover_url, asset_counts: { color: 0, font: 0, logo: 0, image: 0 }, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() }; }
function mapAsset(row: any): BrandKitAsset { return { id: row.id, asset_type: row.asset_type, display_name: row.display_name, role: row.role, sort_order: row.sort_order, text_content: row.text_content, file_url: row.file_url, metadata: row.metadata ?? {}, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() }; }
