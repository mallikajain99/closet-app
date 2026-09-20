import Link from "next/link";
import { notFound } from "next/navigation";

import { logOutfitWear } from "@/app/(app)/outfits/actions";
import { OutfitFigure } from "@/components/outfits/outfit-figure";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { readSilhouette } from "@/lib/validation/item";
import { parseWornOn } from "@/lib/validation/wear";
import { formatMonthKey } from "@/lib/wears/calendar";
import { hasHappened } from "@/lib/wears/planned";

export const metadata = { title: "Pick an outfit" };

/**
 * Fill a day on the calendar.
 *
 * Reached by tapping an empty cell, which is the moment the user is already thinking
 * about that specific date — so the date is fixed here and only the outfit is chosen,
 * the reverse of logging from an outfit's own page. Works in both directions in time:
 * a past day is a wear being remembered, a future one is a plan.
 */
export default async function PickOutfitForDayPage(
  props: PageProps<"/calendar/[date]">,
) {
  const { date } = await props.params;
  const wornOn = parseWornOn(date);
  if (!wornOn) notFound();

  const user = await requireUser();

  const [outfits, alreadyLogged] = await Promise.all([
    db.outfit.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
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
    }),
    db.wearLog.findMany({
      where: { userId: user.id, wornOn },
      select: { outfitId: true },
    }),
  ]);

  const items = outfits.flatMap((outfit) =>
    (outfit.currentVersion?.items ?? []).map((link) => link.item),
  );
  const urls = await getItemImageUrls(items, "thumbnail");

  const loggedIds = new Set(alreadyLogged.map((wear) => wear.outfitId));
  const isPlan = !hasHappened(wornOn);
  const label = wornOn.toLocaleDateString("en-US", {
    dateStyle: "full",
    timeZone: "UTC",
  });
  // `MonthKey.month` is 1-based, unlike `getUTCMonth()`.
  const backToMonth = `/calendar?month=${formatMonthKey({
    year: wornOn.getUTCFullYear(),
    month: wornOn.getUTCMonth() + 1,
  })}`;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href={backToMonth} className="label text-ink-subtle hover:text-ink">
          ← Calendar
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">{label}</h1>
        <p className="mt-1 text-meta text-ink-subtle">
          {isPlan
            ? "Planning ahead — this counts towards nothing until the day arrives."
            : "Pick what was worn."}
        </p>
      </div>

      {outfits.length === 0 ? (
        <p className="mx-auto mt-16 max-w-sm text-center text-meta leading-relaxed text-ink-muted">
          No saved outfits yet.{" "}
          <Link href="/outfits/new" className="underline underline-offset-4 hover:text-ink">
            Build one
          </Link>{" "}
          and it will show up here.
        </p>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {outfits.map((outfit) => {
            const pieces = (outfit.currentVersion?.items ?? []).map((link) => link.item);
            const done = loggedIds.has(outfit.id);

            return (
              <li key={outfit.id}>
                {/* A plain form per outfit rather than a shared radio group: one tap
                    files the day, which is the whole interaction. */}
                <form
                  action={async () => {
                    "use server";
                    const data = new FormData();
                    data.set("wornOn", date);
                    await logOutfitWear(outfit.id, null, data);
                  }}
                >
                  <input type="hidden" name="wornOn" value={date} />
                  <button
                    type="submit"
                    disabled={done}
                    className="group w-full text-left disabled:cursor-default"
                  >
                    <div
                      className={`bg-surface-sunken transition-opacity ${
                        done ? "opacity-40" : "group-hover:opacity-80"
                      }`}
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
                        sizes="(max-width: 640px) 50vw, 260px"
                      />
                    </div>
                    <p className="mt-3 truncate text-ink">{outfit.name}</p>
                    <p className="text-meta text-ink-subtle">
                      {done
                        ? isPlan
                          ? "Already planned"
                          : "Already logged"
                        : `${pieces.length} ${pieces.length === 1 ? "piece" : "pieces"}`}
                    </p>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
