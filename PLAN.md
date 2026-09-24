# Digital Closet Manager — Implementation Plan

**Status:** Phases 0–5 complete. Phase 5 was taken ahead of Phase 4 deliberately — wear logging works on loose items, and analytics only get interesting once wear data has accumulated. **Phase 4 is now built**: outfits are composed slot by slot, named automatically from their pieces, edited with their history intact, filtered by occasion, and logged to a date from the outfit page. The catalog gap that blocked it is closed — 178 items (69 tops, 30 outerwear, 27 shoes, 22 bottoms, 21 dresses, 7 hats, 2 bags), every one with a render and a price. Outfit photos remain specced but unbuilt, so the layered composite is still the only on-body visual. **Next: Phase 6 (stats and cost-per-wear dashboard)**, which the wear data is finally deep enough to make meaningful
**Last updated:** 2026-09-20
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
     reaches beyond the garment's bounding box — **both axes**. A hook and its bar are one
     island, so the bar goes even though it overlaps the shoulders; toggles and cuffs lie
     wholly inside the box and are unreachable by construction. The vertical-only version
     of this test kept whole hangers on cropped tops, whose shoulders sit level with the
     hanger's arms;
   - semi-transparent pixels outside those lines are cleared too, since a white hanger on a
     pale backdrop returns at partial alpha and is invisible to the island pass;
   - a **safety valve** discards the mask entirely if it wants to erase more than 25% of the
     garment, falling back to a plain crop above the garment. That is what keeps a pale
     pinstripe top intact rather than reduced to fragments.

   A hanger bar seen *through* a collar opening is the one case still unsolved. It sits
   inside the garment's box on every side, so geometry alone keeps it. There is a rule for
   it — an island that is wide, thin, level, high on the garment *and* enclosed by garment
   on all sides is a bar, not a feature — but it only fires when the coarse mask actually
   excludes the neck opening, and on the item tested it did not: the mask traces the
   garment's outer silhouette and calls the opening clothing, so there is no enclosed
   region to judge. Unconfirmed whether that holds generally.

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

### Outfit photos — the outfit's visual, not a wear log (added 2026-09-19)

Photos of the user wearing an outfit belong to the **outfit** and carry no date. A new
`OutfitPhoto` table (`outfitId`, original + processed keys, `ProcessingStatus`, `createdAt`)
holds any number of them.

**They are the outfit's primary visual, not a diary.** Where an outfit has a photo, that photo
is what gets shown wherever the outfit appears — list, detail page, and any calendar day it was
worn. The layered composite is the fallback for outfits nobody has photographed.

This is worth stating plainly because it retires a goal the plan has carried since August. §1.2
worked through four ways to show clothes on a body and settled on a mannequin composite because
generative approaches drift from the real garment. A photograph of the user in the outfit is
exact by construction — it is not an approximation of the goal, it *is* the goal. The composite
becomes the stand-in for the un-photographed case, which further weakens any argument for
sourcing a mannequin figure (decision 5).

**Per-wear OOTD photos are dropped.** The `ootd*` columns on `WearLog` stay in the schema
unused rather than being migrated away; nothing reads them, and removing columns from a live
table is not worth the churn for three nullable fields.

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
| **4 — Outfit builder** ✅ **done** | Composite layout, per-slot pickers grouped by kind, live preview, save / tag, signature + duplicate detection, edit-in-place (new `OutfitVersion`), outfit list with occasion filtering, outfit detail, wear logging against an outfit. Names are **generated, not requested** (`lib/outfits/name.ts`) and re-derived when an item is renamed or deleted (`lib/outfits/naming-sync.ts`). **Not built: per-item scale/offset adjustment** — the measured-render layout removed the need, and no garment has yet wanted a manual nudge. **Not built: outfit photos** (`OutfitPhoto`), still specced; the composite remains the only on-body visual | ✅ Real outfits built, named, edited and worn |
| **5 — Wear tracking** ✅ **done** | ✅ Built: log a wear from the item page, today or backdated, with last-worn shown and individual wears removable. Logging is idempotent per day, so a repeat tap joins that day rather than counting twice. Loose items for one day share a `WearLog` with no outfit, which is what the nullable `outfitId` was reserved for — an outfit wear becomes the same row once Phase 4 lands. ✅ Calendar month view with image-first cells, UTC month maths so dates land in the right cell. **Per-wear OOTD photos dropped from scope** (2026-09-19) — the goal is seeing an outfit on a body, which outfit-level photos handle; a per-day photo is a diary nobody keeps. **Phase 5 is complete** | Daily logging habit starts; occasion pieces can be corrected off the neglected list |
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
| 2026-09-24 | **Ask where the hanger is, instead of erasing what isn't clothing.** Every failure this module has had comes from one assumption: that a coarse clothing mask's silence means "delete". It misses rope toggles, collar bands, pale pinstripes and — most visibly — spaghetti straps, so every camisole came back strapless. A third prompted mask now names the *hanger* positively, and a pixel is only erased where two independent models agree: this one says hanger and the clothing mask declines to say clothing. A missed strap is then merely not-clothing, which on its own means nothing. Tried as a *replacement* for the geometric pass first, and that was wrong in an instructive way — better precision, worse recall: straps came back but pale wire hangers the model can't see survived, and a lace top that had been clean regressed. So the hanger mask feeds the geometric pass rather than replacing it. A doomed island has its hanger pixels removed first, which breaks the join between strap and hanger; what is left splits into pieces, and a piece taller than it is wide that reaches the garment is a strap and stays. With no hanger detected the island is one wide piece and goes as before. Also: semi-transparent pixels the clothing mask doesn't claim are cleared wherever they are, not only outside the garment's box — a wire hanger threaded through a camisole's straps sits inside it. **Known remaining:** thin dark straps against a pale door are sometimes dropped by background removal itself, before any of this runs, and nothing downstream can recover what was never in the alpha. |
| 2026-09-22 | **Any number of pieces per slot.** One garment per slot forced a choice the wardrobe doesn't: "I layer sweaters but can't select multiple tops", and then "should allow me to layer everything". The data model never needed the restriction — `OutfitItem` has always carried a slot *and* an order, with no uniqueness on the slot — so this is a builder and layout change only. Pick order is layer order, last picked outermost, numbered on the tile once a slot holds more than one. The composite generalised with it: the spread now takes every shoulder-hung garment in paint order rather than one per category, which previously left a second top stacked exactly on the first, and shoulder matching now normalises all the layers to the geometric mean of their widths instead of just a top and an outerwear. Dresses stay out of the matching, since scaling one to a shirt's shoulder would drag its hem off the length rule that owns it. Spec §2 updated. |
| 2026-09-20 | **Hanger removal: erase on both axes, not just the vertical one.** Hangers were surviving on a lot of items. The island test asked only whether a region reached above or below the garment — so on a cropped top, whose shoulders sit level with the hanger's arms, the whole hanger counted as "inside the garment" and was kept. Both arms and the semi-transparent ghost of the pale one now go, because both the island test and the semi-transparent sweep consider the horizontal extent too. Verified by re-running the three historically fragile items — a pinstripe blazer, a lace top, a cardigan — all intact, lapels, lace holes, buttons and collar. **Still unsolved:** a bar seen *through* a neckline. There is a rule for it (wide, thin, level, high, and enclosed by garment on all sides) but it only fires when the coarse mask excludes the neck opening, and on the item tested the mask traced the outer silhouette instead, leaving no enclosed region to judge. |
| 2026-09-20 | **"Multicolour" stops being a colour and becomes a tag.** A colour family needs a swatch and no swatch is honest about a print — the beige it had made the chip read as one more neutral. Being colourful is a property of the garment, like being for work, so it joins the tag vocabulary and the colour field keeps only colours it can name. `scripts/normalize-colors.ts` migrated the four affected items; one is left with no recorded colour, which is correct rather than lossy, since "multicolour" never named one. Spec §1 unchanged — it already described filtering on families. |
| 2026-09-20 | **Every item is priced, at intake rather than by a later sweep.** Cost-per-wear is undefined without a price, and 55 of 178 items had none — a third of the closet contributing nothing to the number the app exists to report. Asking at intake would be accurate and would also stop the closet being catalogued, so items are estimated on save instead, flagged `priceEstimated` and overwritten the moment a real figure is typed. The model moved out of `scripts/estimate-prices.ts` into `lib/items/estimate-price.ts` so the form, the bulk importer and the backfill script cannot price the same garment three different ways. Eighteen garment types added while doing it — without a base of their own, a floor-length gown and a jersey mini both took the DRESS fallback and came out the same price, which is the single number a category fallback can offer. Backfilled: 0 items now lack a price or a render. Spec §1 updated. |
| 2026-09-20 | **An empty calendar day is a way in.** Tapping one opens `/calendar/[date]`, a picker with the date fixed and only the outfit left to choose — the reverse of logging from an outfit's page, and the right way round for the moment the user is already looking at a particular day. Past and future both work, which is what makes it the natural home for planning. |
| 2026-09-20 | **Outfits can be planned, not only logged.** Forward-dated wears were rejected outright — "forward-dating is always a mistake" — which is wrong: deciding on Sunday what to wear on Friday is the other half of what a calendar is for. Plans and wears share the `WearLog` table rather than getting their own, because they are the same row seen from either side of the date: Friday's plan *becomes* Friday's wear with nothing to migrate and no second record to disagree. The price is one invariant that has to hold everywhere — **a plan is counted nowhere** — so every wear count, `lastWorn`, and cost-per-wear now filters on `happened()` from the new `lib/wears/planned.ts`, and the comparison is against UTC midnight rather than `now`, or tomorrow's plan would flip to "happened" partway through today. Planned days are outlined rather than filled on the calendar and labelled in wear lists, so a month of intentions never reads as a month of wears. Spec §3 updated. |
| 2026-09-20 | **A dress no longer blocks the top slot.** Tops and sweaters are routinely worn over dresses, but `CATEGORY_SLOT` filed both under `TOP`, so choosing one cleared the other. New `DRESS` value on the `Slot` enum (migration `add_dress_slot`), its own builder slot, and `z` between outerwear and top so the top layers over it. Nine existing rows were backfilled. The layer spread generalised from a pair to however many shoulder-hung layers are present, so a cardigan, dress and top come out left-centre-right. Shoulder matching deliberately does *not* extend to dresses: it works by scaling, and scaling a dress to a shirt's shoulder would drag its hem with it, overruling the length rule that owns that number. Caught late that the running dev server still had the pre-migration Prisma client — the exact failure `check-pages.sh` exists to catch, and it would have caught it had I run it before handing back. Spec §2 updated. |
| 2026-09-20 | **Import 34 more (batches 08–09).** 15 tops — tees, camisoles, halters and ribbed tanks — plus a Converse product screenshot, the first item sourced that way rather than photographed. The batch-08 run lost 8 of 15 uploads to the Supabase keep-alive degradation already documented in `import-photos.ts`; a second run in a fresh process took the rest, which is the same short-lived-process workaround the pipeline uses. |
| 2026-09-20 | **Import 18 more (batch 07); swap the layer order.** 9 tops, 8 dresses and a skirt, taking the closet to 162. Two dresses arrived as a shift and a sheath — both knee-length by convention, neither saying so in its name, so they joined the "states no length" rule beside sweater dress and gown. Separately, the layer spread added earlier was the wrong way round: outerwear now sits **left and behind**, the top **right and in front**. That makes `z` the reverse of how the garments are worn, which is correct for a flat lay — laid side by side, the piece nearest the skin is the one worth keeping legible where the two meet. Outerwear still paints over the waistband, so the pair reads as one torso. Spec §2 updated. |
| 2026-09-20 | **Layering fixed three ways, and an outfit can start from an item.** Feedback on a real four-piece outfit: a cardigan centred over a shirt hid it entirely, and the two read as one garment. (1) **Spread** — the outer layer moves off the centre line so the pair overlaps rather than covers, which is what flat-lay styling does. (2) **Matched shoulder widths** — heights come from the landmark table, so a garment's drawn *width* is whatever its photo's aspect ratio makes it; measured across the closet that runs 0.16–0.46 of the figure, a factor of nearly three, so the narrow layer looked like a different size of clothing. Both are scaled to the **geometric** mean of their widths — an arithmetic mean sits nearer the larger one, so it would shrink the wide garment a third while asking the narrow one to nearly double. Scaling is applied around the shoulder line, so the hem moves and the anchor doesn't. (3) **Shoes capped at a token overlap** with the hem above them: the anatomical overlap is large and reads correctly only when there's a leg behind it. All three live in `composeOutfit`, not in the component, because gap-closing and the frame clamp both measure these heights — resizing afterwards would crop the garment it just grew. Also: every item page gained a **Build an outfit** action that opens the builder with that garment in its slot, since an outfit starts from a piece in mind rather than from an empty form. Noted while there: `scripts/outfit-preview.ts` still uses the pre-landmark `centre` model and no longer shares this table — a stale calibration tool, and the comment claiming they can't drift was removed. Spec §1–2 updated. |
| 2026-09-20 | **Dresses enter the closet (batch 06).** 21 items imported — 13 dresses, the first in the catalog, plus 7 tops and a cardigan. Dresses exposed a hole in `LENGTH_OVERRIDES`: the table read "mini" and "maxi" out of a name, but **"gown" and "sweater dress" state no length at all**, so a floor-length gown and a thigh-length knit dress both fell to the category default and rendered at the same knee length. Both now have rules. Also fixed a latent regex bug while adding them — `\bmaxi|gown\b` anchors only the first and last branch of an alternation, so the middle terms of any such pattern match inside other words; the new rules are grouped as `\b(maxi|gown)\b`. |
| 2026-09-20 | **Calendar shows the outfit as it is now, not the version worn.** A day logged before shoes were added to its outfit kept rendering the two-piece version — the cell was labelled with the outfit's name and linked to the outfit, so the picture disagreed with its own destination. Wears keep their `OutfitVersion` snapshot, because the exact-combination stat depends on it; only the *display* follows the live outfit. Alongside: bags moved out of the vertical stack to hang at the hip (centred, a handbag reads as a garment); calendar cells render the full composite instead of a four-thumbnail grid that silently dropped pieces; the outfit list gained occasion-tag filtering with counts from the unfiltered set. Spec §1–3 updated. |
| 2026-09-20 | **`scripts/check-pages.sh` added — and was lying for its first two runs.** Written because the same failure kept reaching the user: a change lands, the dev server keeps serving a stale Tailwind build or a pre-migration Prisma client, and the page renders blank while `npm run build` passes, because the build is a different process from the one serving the page. The script restarts the server, opens each page, and greps the log. Its own assertions were broken: under `pipefail`, `grep -q` exits at the first match and the `printf` feeding it dies of SIGPIPE, so the pipeline reports 141 and the page reads as failing — but only when the match isn't the last line, which is what disguised it as an app fault. `grep -c` reads all input and has no such edge. |
| 2026-09-20 | **Phase 4 built — outfits.** Builder, list, detail, edit, and wear logging against an outfit. Three decisions worth keeping. (1) **Names are generated, not requested.** Naming is the only part of saving an outfit the app can't infer, and demanding it turns a two-tap action into a writing task; the field arrives pre-filled from the pieces and the user overwrites it or doesn't. Collisions resolve by getting *more* specific — naming the third garment — rather than by a numeric suffix, and `lib/outfits/naming-sync.ts` re-derives auto-names when an item is renamed, recoloured or deleted while leaving hand-written names alone. (2) **Deleting an item is never blocked by its outfits** — `OutfitItem.item` went from `onDelete: Restrict` to `Cascade`, the outfit survives as its remaining pieces, and an emptied outfit is deleted; refusing made the outfits authoritative over a closet the user no longer owns. (3) **Per-slot pickers group by kind** — all the jeans, then the trousers, then the skirts — because one row of 38 tops is a scrolling problem, not a choosing one. Per-item scale/offset adjustment was dropped: measured render dimensions removed the need for a manual nudge. |
| 2026-09-19 | **Correction: outfit photos are the outfit's visual, not a wear log.** The previous entry specced them as a dated record with a wear-photo-wins precedence chain. Wrong framing — the goal is simply to see an outfit on a body, so the photos carry no date and a photo, where one exists, *is* how the outfit is shown everywhere it appears. Two consequences. **Per-wear OOTD photos are dropped**, which closes Phase 5; the unused `ootd*` columns stay on `WearLog` rather than being migrated away for three nullable fields. And it retires a goal carried since August: §1.2 evaluated four ways to render clothes on a body and settled on a mannequin composite because generative drifts from the real garment — a photograph of the user in the outfit is exact by construction, so the composite becomes the fallback for un-photographed outfits and decision 5 weakens further. |
| 2026-09-19 | **Outfit photos specced (not yet built).** Requirement change: photos of the user wearing an outfit attach to the **outfit**, uploaded when creating it or later, and the calendar pulls the outfit's most recent photo for any day it was worn. That is a different model from the per-wear OOTD photo already specced, so the two now coexist with an explicit precedence — wear photo, then outfit's latest, then garment cutouts — because a per-wear photo is the only genuine record of a given day, while an outfit photo may post-date the wear it illustrates. Needs a new `OutfitPhoto` table; deliberately not migrated yet, since outfits cannot be created until Phase 4 and a migration for an unbuildable feature is risk without benefit. Spec §2 and §3 updated. |
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
