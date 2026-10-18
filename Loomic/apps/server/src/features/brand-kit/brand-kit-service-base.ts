import type {
  BrandKitAssetCreateRequest,
  BrandKitAssetUpdateRequest,
  BrandKitCreateRequest,
  BrandKitDetail,
  BrandKitAsset,
  BrandKitSummary,
  BrandKitUpdateRequest,
} from "@helstera/shared";

import type { AuthenticatedUser } from "../../auth/types.js";
import type { StorageProvider } from "../../storage/index.js";

export type BrandKitServiceDeps = {
  storage: StorageProvider;
};

const BRAND_KIT_BUCKET = "brand-kits";

const KIT_NOT_FOUND_MESSAGE = "Brand kit not found.";
const KIT_CREATE_FAILED_MESSAGE = "Unable to create brand kit.";
const KIT_UPDATE_FAILED_MESSAGE = "Unable to update brand kit.";
const KIT_DELETE_FAILED_MESSAGE = "Unable to delete brand kit.";
const KIT_QUERY_FAILED_MESSAGE = "Unable to load brand kits.";
const ASSET_NOT_FOUND_MESSAGE = "Brand kit asset not found.";
const ASSET_CREATE_FAILED_MESSAGE = "Unable to create brand kit asset.";

type BrandKitServiceErrorCode =
  | "brand_kit_not_found"
  | "brand_kit_create_failed"
  | "brand_kit_update_failed"
  | "brand_kit_delete_failed"
  | "brand_kit_query_failed"
  | "brand_kit_asset_not_found"
  | "brand_kit_asset_create_failed";

export class BrandKitServiceError extends Error {
  readonly statusCode: number;
  readonly code: BrandKitServiceErrorCode;

  constructor(
    code: BrandKitServiceErrorCode,
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type BrandKitService = {
  listKits(user: AuthenticatedUser): Promise<BrandKitSummary[]>;
  getKit(user: AuthenticatedUser, kitId: string): Promise<BrandKitDetail>;
  createKit(
    user: AuthenticatedUser,
    input: BrandKitCreateRequest,
  ): Promise<BrandKitDetail>;
  updateKit(
    user: AuthenticatedUser,
    kitId: string,
    input: BrandKitUpdateRequest,
  ): Promise<BrandKitDetail>;
  deleteKit(user: AuthenticatedUser, kitId: string): Promise<void>;
  createAsset(
    user: AuthenticatedUser,
    kitId: string,
    input: BrandKitAssetCreateRequest,
  ): Promise<BrandKitAsset>;
  updateAsset(
    user: AuthenticatedUser,
    kitId: string,
    assetId: string,
    input: BrandKitAssetUpdateRequest,
  ): Promise<BrandKitAsset>;
  deleteAsset(
    user: AuthenticatedUser,
    kitId: string,
    assetId: string,
  ): Promise<void>;
  uploadAsset(
    user: AuthenticatedUser,
    kitId: string,
    assetType: "logo" | "image",
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<BrandKitAsset>;
  duplicateKit(
    user: AuthenticatedUser,
    kitId: string,
  ): Promise<BrandKitDetail>;
};
