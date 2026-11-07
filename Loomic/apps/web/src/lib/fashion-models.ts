import type { ImageModelInfo } from "./server-api";
import { TOKEN_BILLING_RESERVE_CREDITS } from "@helstera/shared";
export type FashionModel = {
  id: string;
  displayName: string;
  priceLabel: string;
  resolution: string;
  available: boolean;
  reason: string;
  provider: string;
};
export function fashionModels(
  models: ImageModelInfo[],
  unavailable: (ImageModelInfo & { availabilityReason?: string | null })[] = [],
): FashionModel[] {
  const seen = new Set<string>();
  return [
    ...models.map((model) => ({ model, offline: false })),
    ...unavailable.map((model) => ({ model, offline: true })),
  ].flatMap(({ model, offline }) => {
    if (seen.has(model.id)) return [];
    seen.add(model.id);
    const credits = model.creditCost;
    const tokenBilling =
      model.billingUnit === "per_million_tokens" &&
      typeof model.providerInputTokenPriceCny === "number" &&
      typeof model.providerOutputTokenPriceCny === "number";
    const known =
      (typeof credits === "number" &&
        Number.isFinite(credits) &&
        credits >= 0) ||
      tokenBilling;
    const reference = model.capabilities?.imageToImage !== false;
    const reason = !reference
      ? "不支持参考图试穿"
      : offline
        ? "availabilityReason" in model
          ? String(model.availabilityReason || "模型暂不可用")
          : "模型暂不可用"
        : model.accessible === false
          ? "余额不足或尚未登录"
          : !known
            ? "价格未配置，暂不可生成"
            : "";
    return [
      {
        id: model.id,
        displayName: model.displayName,
        provider: model.provider,
        resolution: model.limits?.maxResolution ?? "由模型决定",
        priceLabel: tokenBilling
          ? `预占 ${TOKEN_BILLING_RESERVE_CREDITS} 积分，按实际 Token 结算`
          : known
            ? `${credits} 积分 / 张`
            : "价格待配置",
        available: !reason,
        reason,
      },
    ];
  });
}
