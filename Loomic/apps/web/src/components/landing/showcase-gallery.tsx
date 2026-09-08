"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/landing/section-header";
import { StaggerContainer, scaleUp } from "@/components/landing/motion";

interface GalleryItem {
  category: string;
  title: string;
  image: string;
  colSpan?: string;
  rowSpan?: string;
}

const GALLERY_ITEMS: GalleryItem[] = [
  { category: "数字艺术", title: "梦幻水母 · AI 数字雕塑", image: "/images/showcase/showcase-1.jpg", rowSpan: "row-span-2" },
  { category: "潮流时尚", title: "朋克牛仔 · AI 时尚造型", image: "/images/showcase/showcase-10.jpg", colSpan: "col-span-2" },
  { category: "艺术摄影", title: "暗调飘逸 · AI 风格化写真", image: "/images/showcase/showcase-2.jpg" },
  { category: "创意拼贴", title: "东方美学 · AI 混合媒体", image: "/images/showcase/showcase-3.jpg" },
  { category: "静物写真", title: "复古珠宝盒 · AI 精致静物", image: "/images/showcase/showcase-4.jpg" },
  { category: "时尚大片", title: "复古运动风 · AI 编辑摄影", image: "/images/showcase/showcase-5.jpg", colSpan: "col-span-2" },
  { category: "人像摄影", title: "清新双人 · AI 自然光写真", image: "/images/showcase/showcase-11.jpg" },
  { category: "光影摄影", title: "闪光灯下 · AI 戏剧性光影", image: "/images/showcase/showcase-12.jpg", rowSpan: "row-span-2" },
];

function GalleryCard({ item }: { item: GalleryItem }) {
  return (
    <motion.div
      variants={scaleUp}
      className={cn(
        "relative rounded-2xl overflow-hidden group cursor-pointer",
        "glass p-1.5",
        item.colSpan,
        item.rowSpan,
      )}
    >
      <div className="relative rounded-[1.25rem] overflow-hidden h-full w-full">
        <Image
          src={item.image}
          alt={item.title}
          fill
          unoptimized
          className="object-cover transition-all duration-300 duration-700 group-hover:scale-[1.04]"
          loading="lazy"
          sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
        />

        {/* Hover overlay — glass sheet */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 duration-500 flex flex-col justify-end p-5"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, oklch(0.10 0.02 260 / 0.7) 100%)",
            backdropFilter: "blur(2px)",
          }}
        >
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium tracking-wide w-fit mb-2 bg-white/15 text-white backdrop-blur-md border border-white/20">
            {item.category}
          </span>
          <p className="text-white text-sm font-light leading-snug">
            {item.title}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export function ShowcaseGallery() {
  return (
    <section id="showcase" className="py-32 md:py-40">
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-24 md:mb-32">
          <SectionHeader
            title="创意无界"
            subtitle="探索 AI 驱动的无限设计可能"
          />
        </div>

        <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[240px] md:auto-rows-[280px] lg:auto-rows-[260px]">
          {GALLERY_ITEMS.map((item) => (
            <GalleryCard key={item.title} item={item} />
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
