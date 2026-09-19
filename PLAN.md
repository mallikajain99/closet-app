# Digital Closet Manager — Implementation Plan

**Status:** Phases 0–3 complete; Phase 5 (wear tracking) underway ahead of Phase 4, deliberately — wear logging works on loose items today, whereas the outfit builder needs bottoms that don't exist yet, and analytics only get interesting once wear data has had time to accumulate. Wears can now be logged and backdated from the item page; the calendar view and OOTD photo remain. No open decision gates Phase 4. The one real gap is still the catalog itself: 29 tops, 20 outerwear and 2 shoes, so no full outfit can be built and the lower half of the composite geometry stays unvalidated until bottoms are photographed
**Last updated:** 2026-09-19
**Companion doc:** [closet_app_feature_spec.md](./closet_app_feature_spec.md)

> This plan and the feature spec are kept in sync. Any change to requirements should be
> reflected in **both** documents in the same pass — the spec captures *what* the app does,
> this plan captures *how* and *in what order* it gets built.

---

## Platform Decision

**Mobile-first responsive web app, installable as a PWA.**

The spec left platform open. A web app is the right call here: camera capture works through
`<input type="file" accept="image/*" capture="environment">`, the image pipeline has to run
server-side regardless, and a PWA installs to the home screen and behaves like an app without
app-store overhead or a second codebase.

---

## Design Direction

**Clean and simple — let the clothes shine.** References: Everlane / COS product grids for the
catalog, Indyx-style wardrobe apps for the calendar. Full principles in spec §5; the
implementation consequences are:

| Principle | Implementation |
|---|---|
| Imagery leads, chrome recedes | No card borders or shadows in the grid. Item tiles are image + quiet metadata below. Separation via whitespace |
| Warm neutral canvas | Off-white/cream surface tokens, not pure white or dark. Pairs with the transparent-PNG normalization so the grid reads as one set |
| Restrained type | One light-weight sans (e.g. Inter or a grotesque); small uppercase letter-spaced labels; generous line height |
| Color = signal only | Near-neutral palette. Reserve saturated color exclusively for the neglected marker, CPW highlights, and laundry status, so those read instantly |
| Adjustable grid density | Density toggle in the catalog (large / medium / dense), COS-style — browsing and scanning are different tasks |
| Image-first calendar cells | Day cell is filled by the outfit visual, date number small in the corner; empty days stay empty |

This argues for a **thin theme layer over shadcn/ui** — shadcn's defaults are card- and
border-heavy, so the token set (surface colors, radius, shadow → mostly none) should be
customized up front in Phase 0 rather than retrofitted.

**Implemented in Phase 0** as Tailwind v4 `@theme` tokens in `app/globals.css`. Tailwind v4 is
CSS-first — there is no `tailwind.config.ts`. Tokens are grouped as surfaces (`canvas`,
`surface`, `surface-sunken`), ink (`ink`, `ink-muted`, `ink-subtle`), hairlines (`line`), and
**signal** colors (`signal-neglected`, `signal-value`, `signal-laundry`, `signal-danger`) — the
only saturated values in the system. Shadow utilities are deliberately unused; depth comes from
the garment images and the mannequin composite's contact shadows.

---

## 1. Tech Stack

**One Next.js app, Supabase for data + storage + auth, Replicate for the image pipeline.**

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui | Mobile-first responsive, PWA-installable |
| Carousels / layout | Embla Carousel; CSS Grid + absolutely-positioned slots | Spec confirms no 3D mannequin needed — fixed CSS slots suffice |
| Client data | TanStack Query + React Server Components for initial loads | Wear stats change constantly and need invalidation across catalog / detail / dashboard |
| Backend | Next.js Route Handlers + Server Actions (same repo) | App is CRUD + aggregation + one async pipeline; a separate service is unnecessary overhead |
| Background jobs | Next.js `after()` — **Inngest dropped** | Background removal takes 20–60s and cannot block a response, but it also doesn't need a queue: one user, one item at a time, and `after()` already keeps the invocation alive past the response. Inngest would have added a service, an account and a signing-key deploy step to run a single job type. The retry path is `scripts/process-images.ts`, which was already needed for backfill |
| Database | Postgres (Supabase) + Prisma 7 | Relational data with heavy joins and date-range aggregation; arrays/JSONB cover colors and attribute tags |
| Image storage | Supabase Storage (S3-compatible), private buckets + signed URLs | Bundled with DB and auth. Cloudflare R2 is the swap-in if outgrown |
| Image processing | Replicate (hosted models) + `sharp` (normalization) | See pipeline below |
| Auth | Supabase Auth, single user to start | Every table carries `user_id` from day 1, so shared closets become a feature flag, not a migration |
| Hosting | Vercel | Zero-config for Next.js; Supabase integrates directly. `after()` work counts against the route's `maxDuration`, so the catalog pages set it explicitly |
| Charts | Recharts | Dashboard leaderboards and wear-over-time |

### 1.1 Image Processing Pipeline

The trickiest technical piece, as flagged in the spec. Implemented in `lib/images/pipeline.ts`,
which is the single implementation shared by the Server Actions and the backfill script:

1. **Segment** — `BiRefNet` or `RMBG-2.0` on Replicate. Salient-object segmentation: on a
   flat-lay or product shot these cut the garment cleanly. On a model/lifestyle photo they
   return *person + garment* together, which is why step 2 exists.
2. **Remove the support structure** — a prompt-guided clothing mask (`schananas/grounded_sam`)
   says *where clothing is*; the crisp alpha from step 1 supplies the shape. Getting this
   right took four attempts, and the lesson is worth keeping: **"not clothing" must never
   mean "erase."** The mask is coarse and misses rope trim, ribbed collar bands and pale
   pinstripes, and every garment ever damaged here came from trusting it per-pixel. What is
   reliably true is geometry — whatever holds a garment up sits *outside* it, a hanger above
   and a display stand below. So:
   - interior holes in the mask are filled (flood the background inward from the border;
     anything enclosed is a hole), because filling only ever means "don't erase here";
   - non-clothing regions are erased as whole connected **islands**, and only if an island
     reaches beyond the garment's vertical extent. A hook and its bar are one island, so the
     bar goes even though it overlaps the shoulders; toggles and cuffs lie wholly inside the
     two lines and are unreachable by construction;
   - semi-transparent pixels outside those lines are cleared too, since a white hanger on a
     pale backdrop returns at partial alpha and is invisible to the island pass;
   - a **safety valve** discards the mask entirely if it wants to erase more than 25% of the
     garment, falling back to a plain crop above the garment. That is what keeps a pale
     pinstripe top intact rather than reduced to fragments.

   A hanger bar seen *through* a collar opening still survives — it is genuinely behind the
   fabric's own opening, and no masking approach removes it.

   The person-parsing pass this step originally specified isn't needed: the photos are
   garments on hangers, not on a body.
3. **Normalize** — `sharp`, locally, no API cost: trim transparent edges → scale to a
   **per-category** target box (a shoe must not render as tall as a coat) → center on a fixed
   1024×1024 transparent canvas → WebP, plus a 256px thumbnail. The grid loads thumbnails.

**The outfit composite needs its own geometry, separate from the grid's.** `CATEGORY_EXTENT`
above is tuned so a garment fills its catalog tile, which gives outerwear 78% of the canvas
height. On a body a blazer covers shoulders to hips — about 43%. Reusing the grid numbers in
the composite renders a jacket that swallows the entire figure, which is what the first
calibration render showed. `COMPOSITE_GEOMETRY` in `scripts/outfit-preview.ts` holds the
body-relative height and centre per category; `Item.layoutScale` / `layoutOffset` override it
per item. The stored render is the garment padded to the full canvas, so the composite trims
back to the garment's own bounds before rescaling — otherwise the padding is what gets scaled.

Both `original_image_key` and `processed_image_key` are stored, plus `thumbnail_key` and a
`processing_status`. **The two image keys live in different buckets** (`closet-originals` and
`closet-processed`), so a key alone is never enough to mint a signed URL — reads go through
`getItemImageUrls` in `lib/images/storage.ts`, which signs each key against its own bucket and
falls back to the original when there is no render. Signing a processed key against the
originals bucket returns "Object not found", which renders as a silent "No photo".

Progress and failure reasons are written to the `ImageJob` row for the item, which is what the
detail page shows when a cutout fails.

**Hard requirement, implemented:** the user can always re-run the cutout or keep the original
image (`OVERRIDDEN`, excluded from bulk re-runs). No segmentation model is reliable enough to be
a blocking dependency.

Cost: Replicate runs are fractions of a cent per image. A few hundred items is a few dollars, once.

### 1.2 On-Body Rendering — Approach

Full write-up in spec §6. **Decided 2026-08-31: approach D — mannequin-backed layered composite.**
The governing constraint is that garments must stay pixel-accurate, which rules out anything
generative.

| Option | Effort | Verdict |
|---|---|---|
| **D. Mannequin-backed composite** | Days of build, plus real tuning time | **Primary outfit visual** |
| **A. OOTD photo capture** | Days — reuses the Phase 2 pipeline unchanged | **In scope, Phase 5**, as an optional per-wear photo |
| **B. Virtual try-on + pose library** | ~1–2 weeks | **Not planned.** Trades garment fidelity for on-body realism — the wrong side of the trade |
| **C. 3D avatar + cloth simulation** | Months, specialist | **Not planned** |

**Why C is out** (the reference renders are exactly this): body reconstruction from photos is
tractable, but each garment would need an authored 3D mesh built as a sewing pattern. Those neutral-
mannequin reference images are *constructed 3D garments*, not photographs — unreachable from a
photo-based catalog at acceptable fidelity.

**Architecture for D:**

- **Mannequin base.** One neutral, faceless front-facing figure as a static rendered asset (PNG/SVG),
  drawn behind all garment layers. Not 3D geometry — no WebGL, no runtime cost
- **Anchor boxes per category** define position, scale, and z-index against the mannequin's
  proportions. Layer order: mannequin → bottom → top → outerwear → shoes → accessories
- **Soft contact shadows** between layers. This is what sells the depth; without it, accurate
  layering still reads flat
- **Per-item overrides.** `Item.layoutScale` and `Item.layoutOffset`, adjusted once by the user and
  applied everywhere that item appears. Essential for the long tail — dusters, crop tops, oversized
  outerwear — that generic anchors place badly
- **Pure CSS/SVG composition**, no server render. The composite is cheap enough to build live in the
  outfit builder as the user scrolls carousels — which is what makes the live preview in spec §2
  possible, and is a concrete advantage of D over any generative approach

**Source photography is the bigger lever.** Flat-lay photos have no dimension and read as stickers
regardless of compositing quality; hanger, dress-form, or model-shot cutouts retain shoulders and
drape and composite convincingly. This belongs in the capture UX as guidance (spec §1), and it means
intake quality — not renderer sophistication — determines how good the outfit view looks.

**Tuning is the real cost, not the build.** Compositing is straightforward; calibrating anchor boxes
so that a crop top, a tunic, and a maxi dress all sit correctly against one mannequin takes
iteration against real garments. Budget accordingly.

### 1.3 URL Import — Known Limitation

Major retailers (Zara, SSENSE, Net-a-Porter) actively block scrapers and render heavily via JS.
Approach: fetch page → read Open Graph `og:image` / JSON-LD product schema → on failure, fall
back to "paste a screenshot instead."

URL import is **best-effort, not a guaranteed path**. Screenshot upload is the reliable intake
method and ships first (see build order).

---

## 2. Data Model

```
User
Item            id, userId, name, category(enum), subcategory, brand, size,
                colors[], price, purchaseDate, sourceUrl, seasons[],
                attributes(jsonb: sleeveLength, silhouette, formality, material, pattern),
                status(active|laundry|repair|donated|sold), conditionNote, returnByDate,
                originalImageKey, processedImageKey, processingStatus,
                layoutScale?, layoutOffsetX?, layoutOffsetY?   ← per-item mannequin adjustment
Tag             id, userId, name      ← ONE tag set shared by items and outfits (per spec §1)
ItemTag / OutfitTag
Outfit          id, userId, name, currentVersionId, createdAt
OutfitVersion   id, outfitId, signature, createdAt, supersededAt?
OutfitItem      outfitVersionId, itemId, slot(head|top|outer|bottom|shoes|bag|jewelry|other), order
WearLog         id, userId, wornOn(date), outfitId?, outfitVersionId?, note,
                ootdOriginalImageKey?, ootdProcessedImageKey?, ootdProcessingStatus?
WearLogItem     wearLogId, itemId     ← ALWAYS written, even for outfit-level logs
ImageJob        subjectType(item|ootd), subjectId, step, status, error
```

No avatar or render-cache entities are needed: approach D composites in the browser from images
already stored, so there is nothing to generate, queue, or cache.

`ImageJob` is polymorphic over items and OOTD photos because both run the same
segment → normalize pipeline; only the target dimensions differ (garment box vs. full-body frame).

### Two decisions that carry the whole spec

**a) `WearLogItem` is always populated.** Logging an outfit fans out one row per item in it.
Item-level and outfit-level stats then become two independent queries against two tables —
exactly what the spec's "tracked completely separately" rule (§3) demands, with no join gymnastics.

**b) `OutfitVersion.signature`** = hash of the sorted item IDs, indexed per user. This *is* the
outfit identity rule from spec §3, held at the schema level. It provides exact-combination
matching for free: duplicate detection on save, and the "you wore this exact combo recently"
warning as a single indexed lookup.

Note this is an **index, not a unique constraint** — two outfits can legitimately converge on the
same item set through edits. Duplicate detection warns at save time against current versions
rather than being enforced by the database.

### Derived, never stored

Cost-per-wear and neglected flags are **computed at read time**. Both change every time a wear is
logged; storing them guarantees staleness.

The three rules live in `lib/stats/` and `lib/outfits/` as pure functions (spec §3, §4):

| Rule | Where | Behavior |
|---|---|---|
| Item cost-per-wear | `cost-per-wear.ts` | `price ÷ max(wears, 1)` — a never-worn item shows its full price, not a blank. Null only when unpriced |
| Outfit cost-per-wear | `cost-per-wear.ts` | **Sum of the items' individual cost-per-wear values.** Not total price ÷ outfit wears — that would make a new combination of well-worn pieces look expensive |
| Stat windows | `wear-windows.ts` | Month and year are **calendar periods** (August = Aug 1–31), not rolling. Only short windows ("last 7 days") roll |
| Neglected | `neglected.ts` | 2 months (60 days, configurable). For never-worn items the clock starts at **date added to catalog**, not purchase date |

Backdated wears feed all of these identically to same-day logs — which is the mechanism that keeps
rarely-worn occasion pieces off the neglected list.

All four are covered by Vitest (`npm test`), including regression tests for the rejected formulas —
outfit cost-per-wear as total ÷ outfit wears, and month windows as rolling rather than calendar.
These rules have already been corrected once; the tests exist so they cannot drift back silently.

### Resolved — outfit editing carries history (versioned outfits)

**Decision (2026-08-31): edit in place and carry wear history forward.** An outfit is a
continuous, named thing the user curates; swapping one piece shouldn't reset its history or
spawn a near-duplicate in the outfit list.

Implemented via **versioning**, which delivers that without contradicting the spec's exact-
combination rule (§3):

- `Outfit` is the stable identity — id, name, tags. It survives edits and owns the full history.
- `OutfitVersion` is one exact item combination, with its own signature. Editing an outfit
  creates a new version and stamps `supersededAt` on the old one.
- `WearLog` records **both** `outfitId` and the `outfitVersionId` worn that day.

This yields two honest, separately queryable numbers on the outfit detail page:

| Stat | Source | Meaning |
|---|---|---|
| Wears of this outfit | all versions, by `outfitId` | "You've worn this look 14 times" — the continuous history the user asked to keep |
| Wears of this exact combination | current version, by `outfitVersionId` | Satisfies spec §3; drives the "worn this exact combo recently" warning |

The "worn recently" suggestion-assist warning (§3) matches on **signature only**, so it stays
strictly exact-combination and never fires on shared individual pieces.

**Item-level stats are unaffected either way** — `WearLogItem` fans out per item independently of
outfit versioning, so spec §3's "tracked completely separately" guarantee holds regardless.

*Consequence to watch:* if a user edits an outfit repeatedly, the two numbers diverge. The outfit
detail page should label them distinctly rather than showing a single ambiguous "wears" count.

---

## 3. File Structure

```
closet-app/
├── app/
│   ├── (auth)/login/
│   ├── (app)/
│   │   ├── catalog/          page.tsx · [itemId]/page.tsx · new/page.tsx
│   │   ├── outfits/          page.tsx · [outfitId]/page.tsx · build/page.tsx
│   │   ├── calendar/         page.tsx
│   │   ├── dashboard/        page.tsx
│   │   └── settings/         page.tsx
│   └── api/
│       ├── items/            route.ts · [id]/route.ts · import/route.ts
│       ├── uploads/sign/     route.ts
│       ├── outfits/ · wear-logs/
│       └── inngest/          route.ts
├── components/
│   ├── ui/                   (shadcn primitives)
│   ├── catalog/              ItemCard · ItemGrid · FilterBar · NeglectedBadge
│   ├── outfit/               MannequinCanvas · SlotCarousel · OutfitPreview
│   ├── stats/                WearStatsPanel · CostPerWearTile · Leaderboard
│   └── forms/                ItemForm · TagPicker
├── lib/
│   ├── db/                   client.ts · queries/{items,outfits,wear,stats}.ts
│   ├── images/               pipeline.ts · segmentation.ts · normalize.ts · storage.ts
│   ├── import/               scrape.ts
│   ├── outfits/              signature.ts · versions.ts · slots.ts
│   ├── stats/                wear-stats.ts · cost-per-wear.ts · neglected.ts · wear-windows.ts
│   └── validation/           (zod schemas, shared client + server)
├── jobs/                     process-item-image.ts
├── prisma/                   schema.prisma · migrations/
├── prisma.config.ts          connection URLs for migrations (Prisma 7 moved these out of the schema)
└── tests/                    Vitest — mirrors lib/, covers the pure rule functions
```

`lib/` holds all business logic as pure functions with no framework imports — so
`signature.ts`, `cost-per-wear.ts`, and `neglected.ts` are unit-testable without a database or a
browser. Those three encode the rules most likely to be subtly wrong.

---

## 4. Build Order

Each phase ends with something usable, so real clothes can be loaded early and actual use can
shape the later phases.

| Phase | Scope | Done when |
|---|---|---|
| **0 — Foundation** ✅ **done** *(deploy pending)* | Next.js + Tailwind + theme tokens, full Prisma schema migrated to Supabase (11 tables, 6 enums), storage buckets, magic-link auth via `proxy.ts` + `lib/auth.ts`, pure-function core with 51 tests. Remaining: Vercel deploy (see `SETUP.md` Part 3) | ✅ App is live locally and login works |
| **1 — Catalog (raw)** ✅ **done** | Photo/screenshot upload → storage, item metadata form, tags, grid view, detail, edit/delete, hanger/dress-form guidance in the capture flow. **No image processing yet** | ✅ Live in production; real closet can be loaded in from a phone |
| **2 — Image pipeline** ✅ **done** | Segmentation via Replicate with a clothing-mask gate for hangers, per-category normalization onto a 1024px canvas plus a 256px thumbnail, background processing on save via `after()` (no Inngest — see below), pending/failed badges, manual re-run and keep-original override, backfill of all 49 Phase-1 items | ✅ Catalog looks visually uniform |
| **2.5 — Composite calibration** ✅ **done** *(rescoped)* | Was "source the mannequin asset and tune around it". Became: establish the composite geometry, which is the part that actually matters. `COMPOSITE_GEOMETRY` in `scripts/outfit-preview.ts` scales and anchors each category **relative to the figure's own height**, so any figure — or none — works without retuning. Placeholder figure at `public/mannequin/placeholder.svg`; `--figures <dir>` compares candidates under real clothes, `--bare` renders stack-only. Tops and outerwear validated on real garments. **The mannequin asset is deferred** (decision 5) and no longer gates Phase 4. Outstanding: `BOTTOM`/`SHOE`/`HAT` geometry is unvalidated until the catalog has such items | ✅ Real garments composite at correct scale and position | Source or commission the neutral mannequin asset; composite ~10 real garments over it; tune per-category anchor boxes and shadow treatment until a full outfit reads correctly | The outfit visual is proven on real garments before the builder is built around it |
| **3 — Browse & item detail** ✅ **done** | Filters (category / colour / brand / formality / sleeve) and search, all held in the URL; brand jump-through from the item detail page; item detail page *minus* wear stats (built in Phase 1). Facets behind a `<details>` disclosure so four extra chip rows don't crowd the grid. **Not built: the grid density toggle** from the Design Direction table — it wasn't in this phase's scope and nothing depends on it | ✅ Catalog is navigable at 49 items; filters verified against the real closet |
| **4 — Outfit builder** | Mannequin-backed composite layout, per-slot carousels, live preview, per-item scale/offset adjustment, save / name / tag, signature + duplicate detection, edit-in-place (new `OutfitVersion`) + duplicate | Real outfits can be built and saved |
| **5 — Wear tracking** 🔶 **in progress** | ✅ Built: log a wear from the item page, today or backdated, with last-worn shown and individual wears removable. Logging is idempotent per day, so a repeat tap joins that day rather than counting twice. Loose items for one day share a `WearLog` with no outfit, which is what the nullable `outfitId` was reserved for — an outfit wear becomes the same row once Phase 4 lands. ✅ Calendar month view with image-first cells, UTC month maths so dates land in the right cell. **Remaining: the optional OOTD photo per wear** | Daily logging habit starts; occasion pieces can be corrected off the neglected list |
| **6 — Analytics** | Wear stats on item + outfit detail, cost-per-wear throughout, neglected badges, most/least-worn leaderboards, sort by CPW, closet totals | Spec §1–4 fully delivered |
| **7 — Extras** | URL import; laundry status; "surprise me" generator; export JSON/CSV; weather; packing lists; gap analysis; declutter; return-window tracker | Chosen by what's actually missed in use |

### Two deliberate sequencing calls

- **Phase 1 ships before the image pipeline** so a hard problem can't block closet data entry.
  Phase 2 backfills everything loaded in Phase 1.
- **URL import moves to Phase 7** because it's the least reliable intake method. Screenshot
  upload covers the same need from day one.

---

## 5. Open Decisions

| # | Decision | Outcome | Status |
|---|---|---|---|
| 1 | Outfit editing when wear history exists | **Edit in place, carry history forward.** Implemented via `OutfitVersion` so exact-combination stats (spec §3) remain accurate — see Data Model above | Resolved 2026-08-31 |
| 2 | Supabase all-in-one vs. Neon + Cloudflare R2 + Clerk | **Supabase** — Postgres, Storage, and Auth in one project | Resolved 2026-08-31 |
| 3 | Single-user vs. multi-profile at launch | **Single-user for now.** `user_id` on every table from day 1 keeps spec suggestion #10 a feature flag, not a migration | Resolved 2026-08-31 |
| 4 | On-body rendering approach | **D (layered composite), amended 2026-09-18: the mannequin figure is an optional back layer, not the mechanism.** What makes an outfit read correctly is the composite geometry — garments scaled and anchored as if worn. The figure is a single layer behind that, and rendering it is one boolean (`--bare` in `scripts/outfit-preview.ts`). Garment accuracy still outranks on-body realism, so generative approaches remain ruled out; A retained as an optional per-wear photo; B and C not planned | Resolved 2026-08-31, amended 2026-09-18 |
| 5 | Mannequin asset — source or commission? | **Deferred, and no longer blocking anything.** Judged against real renders on 2026-09-18: with one or two garments the figure adds little, and stack-only is arguably closer to the "let the clothes shine" design direction. The case that decides it is top + bottom + shoes, where a body fills the gaps between pieces — and that cannot be evaluated until such items exist in the catalog. Revisit then; a Vecteezy 3D mannequin is a viable candidate if wanted, subject to its attribution terms | Deferred 2026-09-18 — revisit when the catalog has bottoms and shoes |

No open decision blocks Phase 3 or Phase 4. Decision 5 was the last one gating the outfit
builder, and deferring it removes that gate: the builder is built against the composite
geometry, and a figure can be dropped in behind it later without touching the layout.

---

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | **Wear calendar built.** Month grid at `/calendar`, image-first per the design direction — garments fill the cell, the date recedes, and a day with nothing logged gets no fill at all so a sparse month reads as sparse. Month maths lives in `lib/wears/calendar.ts` and is UTC throughout, deliberately separate from `lib/stats/wear-windows.ts`, which is local-time because stats windows follow the user's own calendar: wear dates are UTC midnight, so local-time grid arithmetic puts the 1st of a month in the previous month's last cell west of Greenwich. Tested on the boundaries that fail silently — month length, leap years, Sunday-start months, and that grid keys match a stored `wornOn`. Also fixes a dead header link: `/calendar` was in the nav but had no route. `/outfits` still doesn't. |
| 2026-09-19 | **Phase 5 started — wear logging.** Wears are recorded from the item page, today or backdated, because the spec makes "add a past wear" first-class: occasion pieces get worn and only remembered later, and that is exactly what rescues them from the neglected list. Logging is **idempotent per calendar day** — a second tap for the same item and date joins the existing day rather than counting twice, since otherwise cost-per-wear drifts down with every stray tap, and it is the number the whole app exists to report. Dates are built as UTC midnight to match the `@db.Date` column; parsing "2026-09-19" with `new Date()` west of Greenwich files the wear a day early and feeds the neglected calculation the wrong date, so that is tested. Verified against the real database: repeat logging does not double-count and the stored date round-trips exactly. Remaining for Phase 5: the calendar view and the optional OOTD photo. |
| 2026-09-19 | **Renders centred and rescaled; text casing normalized.** Three consequences of the composite owning its own geometry, which made the stored render's job much simpler. (1) `placeOnCanvas` no longer bakes in a body anchor — it centres — since the only reader of that anchor was an outfit composite that now positions garments itself; the anchor was just pushing items off-centre in their catalog tiles. (2) `CATEGORY_EXTENT` was severe for the same reason (shoes capped at 26% of canvas height, so a pair of flats filled a quarter of its tile); the range is compressed now that the grid is its only consumer. (3) Both changes were applied to existing renders by `scripts/renormalize-images.ts`, which re-fits from the stored render locally — **no Replicate calls** — and lists anything it would upscale past 1.5× for a real re-run instead of quietly blurring it; Tile frames went square with `object-contain` at the same time: a 3:4 tile with `object-cover` had been cropping the garment, which was invisible while items occupied 62% of their canvas and obvious once they filled it. That script hit the same Supabase HTTP/2 session failure the pipeline already documented, and now replaces the client per attempt rather than retrying a dead one. Separately: item titles normalize to sentence case on save, preserving brand spelling and letter-shape terms (V-neck, A-line), and tag names now canonicalize like brands — "Work" and "work" had become two tags splitting 15 items between them, merged to one. |
| 2026-09-19 | **Item form narrows by category.** Sleeve length, silhouette and size are only offered to categories that can have them — a handbag has no sleeves, a necklace no silhouette. Enforced twice: the form unmounts the field (so nothing is submitted) and `buildAttributes` plus the create/update actions drop values for inapplicable fields, which also clears stale attributes when an item's category is changed after the fact. Silhouette suggestions are category-specific while the vocabulary stays open. No existing item violated the new rules. Rules live in `FIELD_CATEGORIES` / `fieldApplies`, so adding a category means editing one table. |
| 2026-09-18 | **Colour filtering grouped into families; estimated prices backfilled.** The colour facet was unusable as built — 49 items carried 28 distinct colours, most appearing once, so nearly every chip matched one garment and the row was longer than the results. Colours now group into families (`lib/items/colors.ts`) matched by keyword rather than enumeration, so an unseen colour still lands somewhere; chromatic families are tested before neutrals so "slate blue" resolves to blue rather than grey. Chips carry a swatch. The written colour is untouched everywhere it is displayed. Verified against the real closet: 28 colours → 13 families, all mapped, and every family's DB count matches its in-memory tally. Separately, 46 items without a price got estimates from a brand-tier × garment × material model calibrated against the three real prices already recorded (which sit near sale price, not list — estimating at list would have inflated the closet by about a third and every cost-per-wear with it). Each is flagged `priceEstimated` so guesses stay distinguishable from facts; `scripts/estimate-prices.ts --clear` removes them. |
| 2026-09-18 | **Phase 3 built** — catalog filters and search. Every facet lives in the URL, extending the Phase 1 category row rather than introducing a second mechanism: the back button works, a filtered view is shareable, and the catalog stays a Server Component with only the search box as a client island. Facet counts come from the unfiltered set so chips keep their numbers and don't reshuffle while narrowing; they're counted in one pass in memory because `colors` is a Postgres array and `formality`/`sleeveLength` live in the attributes JSON, so none is a column to group by. Search covers name, brand and subcategory. Brand on the item detail page links through to the filtered catalog. Verified against the real closet: DB filter counts match the in-memory facet tallies exactly. The grid density toggle in the Design Direction table remains unbuilt. |
| 2026-09-18 | **Mannequin deferred; Phase 2.5 rescoped and closed.** Seeing real garments composited raised the right question — if the figure mostly hides behind the clothes, is it earning its complexity? Rendering the same outfit with and without it showed stack-only is cleaner and closer to the "let the clothes shine" design direction. The case that would justify a figure is top + bottom + shoes, where a body fills the gaps between pieces, and the catalog has nothing below the waist to test it with. Decisive point: the figure is a **single layer at the back** and the composite geometry is independent of it, so this is reversible at any time and costs nothing to defer — including the Vecteezy licence question. Decision 4 amended (the figure is an optional layer, not the mechanism), decision 5 deferred, Phase 2.5 closed on the geometry alone. **Nothing now gates Phase 3 or 4.** |
| 2026-09-18 | **Phase 2.5 started with a placeholder figure.** Rather than sourcing an asset in the abstract, built a crude neutral silhouette and the calibration loop (`scripts/outfit-preview.ts`) to composite real garments over it. Two findings. (1) The composite needs geometry of its own — see §1.1 — because the grid's `CATEGORY_EXTENT` renders a blazer that covers the whole figure. (2) The figure must sit *inside* the clothes: a first silhouette with 278px shoulders showed grey poking out past a blazer, so it was narrowed to 220px against a size-M blazer's ~370px. Tops and outerwear now read correctly; the `BOTTOM`/`SHOE`/`HAT` geometry is unvalidated because the catalog holds only 33 tops and 16 outerwear. Decision 5 still open, but now decidable against something visible. |
| 2026-09-17 | **Hanger removal reworked; catalog reprocessed.** The four renders flagged on 09-13 were never actually fixed — the algorithm change landed at 07:29 UTC on 09-14 but the newest render was from 05:25 UTC, so the fix was verified on a temp file and never written back. Reprocessing exposed that both existing approaches failed in opposite directions: the per-pixel mask gate punched holes through fabric (destroying a suede vest's rope toggles and a pale pinstripe top), while cropping above the garment left hanger bars catalog-wide. Replaced with island-based removal keyed on geometry rather than on the mask's per-pixel opinion — see §1.1 step 2 — plus a broader mask prompt (it had no word for "vest"), a wider gate to bridge thin collar bands, and a 25% safety valve. All 49 items reprocessed; no failures. Two sweaters shot on a display *stand* rather than a hanger drove the rule to be symmetric: support structure is anything reaching outside the garment's vertical extent, above or below. |
| 2026-09-17 | **Phase 2 complete.** The pipeline moved out of the backfill script into `lib/images/pipeline.ts`, shared by the catalog Server Actions and `scripts/process-images.ts`. **Inngest dropped** — `after()` covers a single job type for a single user without adding a service; the script remains the retry path, and the catalog pages set `maxDuration` because `after()` work counts against the route's timeout. Added pending/failed badges and the two manual overrides (re-run, keep original as `OVERRIDDEN`, which bulk re-runs skip). Failure reasons are persisted on `ImageJob` and shown on the item detail page. **Bug found and fixed:** all 49 processed renders were invisible in the app — pages signed the processed key against the *originals* bucket, so every item silently fell back to "No photo". Reads now go through `getItemImageUrls`, which signs per bucket; item deletion had the same bug and was leaking renders and thumbnails. Spec §1 gains the background-processing and override guarantees. |
| 2026-08-31 | Initial plan drafted from `closet_app_feature_spec.md` |
| 2026-08-31 | Open decisions 1–3 resolved. Outfit editing = edit-in-place carrying history; data model gains `OutfitVersion` and `WearLog.outfitVersionId` to keep exact-combination stats accurate. Supabase confirmed; single-user confirmed. Spec §2 and §3 updated to match. |
| 2026-08-31 | Design direction added (Everlane/COS/Indyx references) → new spec §5, new plan Design Direction section, theme tokens added to Phase 0. On-body rendering evaluated → new spec §6, new plan §1.2; option A (OOTD photo capture) added to Phase 5 and spec §3, option B deferred to Phase 7 pending decision 4, option C ruled out. `WearLog` gains OOTD image fields; `ImageJob` made polymorphic. |
| 2026-08-31 | **Correction + scope change.** The travel-app reference is composited/rendered, not mirror selfies — the two reference screenshots showed different techniques and had been conflated. Goal restated as "me in varied poses per outfit, without photographing each outfit," which is option B. B promoted from deferred Phase 7 experiment to **primary direction**; A demoted to manual override/fallback. Added pose library (`UserPhoto`), render cache (`OutfitRender`), deterministic pose assignment, and a **Phase 2.5 quality spike** gating the Phase 4 builder design. Spec §6 rewritten. |
| 2026-08-31 | **Stats rules corrected.** (1) Outfit cost-per-wear is the **sum of item cost-per-wears**, not total price ÷ outfit wear count. (2) Never-worn items show their **full price** as cost-per-wear rather than a blank. (3) Month/year stat windows are **calendar periods**, not rolling — new `lib/stats/wear-windows.ts`. (4) Neglected threshold confirmed at 2 months, clock starting from date added for never-worn items. (5) Retroactive wear logging promoted to a first-class action on the item detail page, so occasion pieces can be corrected off the neglected list. Spec §1, §3, §4 updated. |
| 2026-09-01 | **Phase 1 built** — item intake, catalog grid, detail, edit, delete. Photos upload browser→storage via signed URL (Vercel's 4.5 MB body limit rules out Server Actions for files); signed URLs minted with the service role, so buckets need no RLS. Prices stored as integer cents. Spec §1 gains guidance on self-worn photos as item sources, and a note that a worn *outfit* photo is not an item source — garments can't be separated out of it, so those belong to wear logging instead. |
| 2026-09-01 | **Phase 0 complete.** Database migrated to Supabase (11 tables, 6 enums); storage buckets created; magic-link auth working end to end via `proxy.ts` (Next 16's rename of `middleware`), with the Supabase auth user upserted into our own `users` table on first sign-in. Access decisions use `getUser()`, not `getSession()`. Remaining: Vercel deploy. |
| 2026-08-31 | **Phase 0 scaffolded locally.** Actual toolchain versions differ from what this plan originally specified and are corrected above: **Next.js 16.3** (not 15 — Turbopack is now the default, request APIs are async-only, `middleware` is renamed `proxy`), **Tailwind v4** (CSS-first `@theme`, no `tailwind.config.ts`), **Prisma 7** (connection URLs moved from `schema.prisma` to a new `prisma.config.ts`; the client now requires a driver adapter, `@prisma/adapter-pg`). Node 26.8.1 installed via Homebrew. Note `npm i -D prisma` resolves to an 8.0 release candidate with an entirely different CLI — the dependency is pinned to `prisma@7` to match `@prisma/client`. |
| 2026-08-31 | **Direction settled: garment fidelity outranks on-body realism.** New approach **D** (mannequin-backed layered composite) becomes the primary outfit visual — real garment cutouts layered over a neutral static mannequin figure with per-category anchors, contact shadows, and per-item scale/offset overrides. **B dropped** (generative = garment drift); `UserPhoto` and `OutfitRender` removed from the data model; `Item` gains `layoutScale`/`layoutOffset`. Phase 2.5 repurposed from try-on spike to mannequin calibration. Hanger/dress-form photography guidance added to spec §1 and Phase 1 — intake quality drives outfit-view quality more than the renderer does. Spec §1, §2, §6 updated. |
