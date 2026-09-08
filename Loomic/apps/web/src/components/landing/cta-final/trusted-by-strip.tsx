"use client";

/**
 * TrustedByStrip — short list of industry verticals shown above testimonials.
 * Pure text, no images, so it stays tiny.
 */
const INDUSTRIES = [
  "快消品牌",
  "科技公司",
  "广告代理",
  "媒体出版",
  "电商平台",
  "教育机构",
];

export function TrustedByStrip() {
  return (
    <div className="space-y-6">
      <p className="eyebrow text-center">已被以下行业团队信赖</p>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-2">
        {INDUSTRIES.map((name) => (
          <span
            key={name}
            className="text-sm font-light text-muted-foreground tracking-wide"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
