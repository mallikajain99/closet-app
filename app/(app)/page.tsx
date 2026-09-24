import Link from "next/link";

import { OutfitFigure, type FigureItem } from "@/components/outfits/outfit-figure";
import { Recommendations } from "@/components/outfits/recommendations";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { readSilhouette } from "@/lib/validation/item";
import { recommend, seasonOf } from "@/lib/outfits/recommend";
import { WEEKDAYS, isoOf, weekOf } from "@/lib/wears/calendar";
import { happened, hasHappened } from "@/lib/wears/planned";
import type { Season } from "@prisma/client";

const SEASONS: Season[] = ["SPRING", "SUMMER", "FALL", "WINTER"];

/** One string out of the attributes JSON, or null when it was never recorded. */
function readAttribute(attributes: unknown, key: string): string | null {
  const value = (attributes as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export const metadata = { title: "This week" };

/**
 * The week, Sunday to Saturday.
 *
 * Home is a week rather than a month because the question it answers is "what am I
 * wearing", which has a horizon of days. The month view is for looking back; this is
 * for looking forward, and an empty day here is an invitation to plan one.
 */
export default async function Home(props: PageProps<"/">) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  const asked = typeof searchParams.season === "string" ? searchParams.season : "";
  const season = (SEASONS as string[]).includes(asked)
    ? (asked as Season)
    : seasonOf();
  const query = typeof searchParams.q === "string" ? searchParams.q : "";

  const week = weekOf();
  const from = week[0];
  const to = week[6];

  const itemFields = {
    select: {
      item: {
        select: {
          id: true,
          name: true,
          category: true,
          subcategory: true,
          attributes: true,
          renderHeight: true,
          renderWidth: true,
          originalImageKey: true,
          processedImageKey: true,
          thumbnailKey: true,
        },
      },
    },
  } as const;

  const wears = await db.wearLog.findMany({
    where: { userId: user.id, wornOn: { gte: from, lte: to } },
    orderBy: { wornOn: "asc" },
    select: {
      id: true,
      wornOn: true,
      outfitId: true,
      items: itemFields,
      // The live outfit, not the version logged — same reason as the month view.
      outfit: {
        select: {
          name: true,
          versions: { where: { supersededAt: null }, select: { items: itemFields } },
        },
      },
    },
  });

  const piecesOf = (wear: (typeof wears)[number]) =>
    (wear.outfit?.versions[0]?.items ?? wear.items).map((link) => link.item);

  const urls = await getItemImageUrls(wears.flatMap(piecesOf), "thumbnail");

  // Every wear on a day, not the last one — two outfits in a day used to silently
  // drop the first here, where the calendar at least merged them.
  const byDay = new Map<string, typeof wears>();
  for (const wear of wears) {
    const key = isoOf(wear.wornOn);
    byDay.set(key, [...(byDay.get(key) ?? []), wear]);
  }
  const today = isoOf(new Date());

  // Every saved outfit, with just enough to rank it: what it is made of, when it was
  // last actually worn (plans excluded), and whether it already has a day this week.
  const saved = await db.outfit.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      tags: { select: { tag: { select: { name: true } } } },
      _count: { select: { wearLogs: { where: happened() } } },
      wearLogs: {
        where: happened(),
        orderBy: { wornOn: "desc" },
        take: 1,
        select: { wornOn: true },
      },
      currentVersion: {
        select: {
          items: {
            select: {
              item: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  subcategory: true,
                  brand: true,
                  colors: true,
                  seasons: true,
                  attributes: true,
                  renderHeight: true,
                  renderWidth: true,
                  originalImageKey: true,
                  processedImageKey: true,
                  thumbnailKey: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const spokenForIds = new Set(wears.map((wear) => wear.outfitId).filter(Boolean));

  /**
   * What kinds of garment were worn in the last few days, so the same kind isn't
   * suggested straight back. Reaches further than the week on screen, because Sunday's
   * suggestions have to know about the previous Thursday.
   */
  const lookback = new Date(from);
  lookback.setUTCDate(lookback.getUTCDate() - 7);
  const recentWears = await db.wearLog.findMany({
    where: { userId: user.id, wornOn: { gte: lookback, ...happened().wornOn } },
    select: {
      wornOn: true,
      items: { select: { item: { select: { category: true, subcategory: true } } } },
    },
  });

  const startOfToday = new Date(`${today}T00:00:00Z`).getTime();
  const recent = recentWears.flatMap((wear) =>
    wear.items.map((link) => ({
      category: link.item.category,
      subcategory: link.item.subcategory,
      daysAgo: Math.round((startOfToday - wear.wornOn.getTime()) / 86_400_000),
    })),
  );

  const groups = recommend({
    season,
    query,
    recent,
    outfits: saved.map((outfit) => {
      const pieces = (outfit.currentVersion?.items ?? []).map((link) => link.item);
      return {
        id: outfit.id,
        name: outfit.name,
        tags: outfit.tags.map((link) => link.tag.name),
        lastWornOn: outfit.wearLogs[0]?.wornOn ?? null,
        wearCount: outfit._count.wearLogs,
        spokenFor: spokenForIds.has(outfit.id),
        items: pieces.map((item) => ({
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          brand: item.brand,
          colors: item.colors,
          seasons: item.seasons,
          formality: readAttribute(item.attributes, "formality"),
          material: readAttribute(item.attributes, "material"),
        })),
      };
    }),
  });

  // Sign only the outfits that made the cut, rather than all 60-odd.
  const shown = new Set(
    Object.values(groups).flatMap((picks) => picks.map((pick) => pick.outfit.id)),
  );
  const shownOutfits = saved.filter((outfit) => shown.has(outfit.id));
  const recommendedUrls = await getItemImageUrls(
    shownOutfits.flatMap((outfit) =>
      (outfit.currentVersion?.items ?? []).map((link) => link.item),
    ),
    "thumbnail",
  );

  const figureItems = new Map<string, FigureItem[]>(
    shownOutfits.map((outfit) => [
      outfit.id,
      (outfit.currentVersion?.items ?? []).map(({ item }) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        silhouette: readSilhouette(item.attributes),
        renderHeight: item.renderHeight,
        renderWidth: item.renderWidth,
        imageUrl: recommendedUrls.get(item.id) ?? null,
      })),
    ]),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-3xl font-light tracking-tight">This week</h1>
        <Link href="/calendar" className="label text-ink-subtle hover:text-ink">
          Full calendar →
        </Link>
      </div>

      {/* Always seven across — a week that wraps is not a week. The columns get narrow
          on a phone, which is the right trade: the shape of the week is the point. */}
      <ul className="mt-8 grid grid-cols-7 gap-x-2 sm:gap-x-4">
        {week.map((day, index) => {
          const iso = isoOf(day);
          const onDay = byDay.get(iso) ?? [];
          const wear = onDay[0];
          const pieces = wear ? piecesOf(wear) : [];
          const isToday = iso === today;
          const isPlan = wear ? !hasHappened(wear.wornOn) : false;
          const extra = onDay.length - 1;

          return (
            <li key={iso}>
              <p
                className={`label ${isToday ? "text-ink" : "text-ink-subtle"}`}
              >
                {WEEKDAYS[index]} {day.getUTCDate()}
                {isToday && " ·"}
              </p>

              <Link
                // A filled day opens what's on it; an empty one opens the picker for
                // that date, so planning the week never needs the calendar page.
                href={
                  wear?.outfitId
                    ? `/outfits/${wear.outfitId}`
                    : pieces.length > 0
                      ? `/catalog/${pieces[0].id}`
                      : `/calendar/${iso}`
                }
                className="mt-2 block"
              >
                {pieces.length > 0 ? (
                  <div
                    className={
                      isPlan
                        ? "border border-dashed border-line-strong"
                        : "bg-surface-sunken"
                    }
                  >
                    <OutfitFigure
                      items={pieces.map((item) => ({
                        id: item.id,
                        name: item.name,
                        category: item.category,
                        subcategory: item.subcategory,
                        silhouette: readSilhouette(item.attributes),
                        renderHeight: item.renderHeight,
                        renderWidth: item.renderWidth,
                        imageUrl: urls.get(item.id) ?? null,
                      }))}
                      sizes="(max-width: 640px) 14vw, 120px"
                    />
                  </div>
                ) : (
                  // Same 2:3 as the figure, so a half-planned week keeps its rhythm
                  // instead of the empty days collapsing.
                  <div className="relative w-full border border-dashed border-line transition-colors hover:border-line-strong">
                    <div style={{ paddingTop: "150%" }} />
                    <span className="label absolute inset-0 flex items-center justify-center text-ink-subtle">
                      +
                    </span>
                  </div>
                )}
              </Link>

              <p className="mt-2 truncate text-meta text-ink-muted">
                {wear?.outfit?.name ??
                  (pieces.length > 0 ? `${pieces.length} pieces` : "Nothing planned")}
                {extra > 0 && ` +${extra}`}
              </p>
              {isPlan && <p className="label text-ink-subtle">Planned</p>}
            </li>
          );
        })}
      </ul>

      <Recommendations
        groups={groups}
        season={season}
        query={query}
        figureItems={figureItems}
      />
    </main>
  );
}
