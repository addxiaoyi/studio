import type { Database } from "@helstera/shared";

import type { HomeDiscoveryCategory } from "./home-discovery-seeds";
import { homeDiscoverySeedCategories } from "./home-discovery-seeds";

type HomeDiscoveryCategoryRow =
  Database["public"]["Tables"]["home_discovery_categories"]["Row"];
type HomeDiscoveryCaseRow =
  Database["public"]["Tables"]["home_discovery_cases"]["Row"];

export function mapHomeDiscoveryRows(
  categories: HomeDiscoveryCategoryRow[],
  cases: HomeDiscoveryCaseRow[],
): HomeDiscoveryCategory[] {
  const casesByCategory = new Map<string, HomeDiscoveryCaseRow[]>();

  for (const item of cases) {
    const group = casesByCategory.get(item.category_key) ?? [];
    group.push(item);
    casesByCategory.set(item.category_key, group);
  }

  return [...categories]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((category) => ({
      key: category.key,
      label: category.label,
      cases: [...(casesByCategory.get(category.key) ?? [])]
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((item) => ({
          id: item.id,
          title: item.title,
          coverImageUrl: item.cover_image_url,
          authorName: item.author_name,
          authorAvatarUrl: item.author_avatar_url,
          viewCount: item.view_count,
          likeCount: item.like_count,
          prompt: item.seed_prompt,
        })),
    }));
}

export function localizeHomeDiscoveryCategories(
  categories: HomeDiscoveryCategory[],
): HomeDiscoveryCategory[] {
  return categories.map((category, categoryIndex) => ({
    ...category,
    cases: category.cases.map((item, itemIndex) => {
      const image = `/images/showcase/showcase-${((categoryIndex * 3 + itemIndex) % 12) + 1}.jpg`;
      return { ...item, coverImageUrl: image, authorAvatarUrl: image };
    }),
  }));
}

export async function loadHomeDiscoveryCategories(): Promise<HomeDiscoveryCategory[]> {
  return localizeHomeDiscoveryCategories(homeDiscoverySeedCategories);
}
