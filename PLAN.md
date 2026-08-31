# Digital Closet Manager — Implementation Plan

**Status:** Phase 0 scaffolded locally; awaiting Supabase credentials to run the first migration. One open item (decision 5, mannequin asset sourcing) is cosmetic and gated to Phase 2.5
**Last updated:** 2026-08-31
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
| Background jobs | Inngest | Background removal takes 5–30s and cannot run inline in a request. Retries, step functions, dashboard, free tier, runs on Vercel |
| Database | Postgres (Supabase) + Prisma 7 | Relational data with heavy joins and date-range aggregation; arrays/JSONB cover colors and attribute tags |
| Image storage | Supabase Storage (S3-compatible), private buckets + signed URLs | Bundled with DB and auth. Cloudflare R2 is the swap-in if outgrown |
| Image processing | Replicate (hosted models) + `sharp` (normalization) | See pipeline below |
| Auth | Supabase Auth, single user to start | Every table carries `user_id` from day 1, so shared closets become a feature flag, not a migration |
| Hosting | Vercel | Zero-config for Next.js; Supabase and Inngest integrate directly |
| Charts | Recharts | Dashboard leaderboards and wear-over-time |

### 1.1 Image Processing Pipeline

The trickiest technical piece, as flagged in the spec. Three distinct steps, run as an Inngest
job on every submitted item:

1. **Segment** — `BiRefNet` or `RMBG-2.0` on Replicate. Salient-object segmentation: on a
   flat-lay or product shot these cut the garment cleanly. On a model/lifestyle photo they
   return *person + garment* together, which is why step 2 exists.
2. **Isolate garment from person** — for model photos, a human-parsing model (e.g.
   `SegFormer` clothes-parsing / `Self-Correction-Human-Parsing`) labels garment regions
   separately from skin/hair/face; mask to the garment class matching the item's category.
   This is the hardest step and quality will vary by source image.
3. **Normalize** — `sharp`, locally, no API cost: trim transparent edges → scale to a
   **per-category** target box (a shoe must not render as tall as a coat) → center on a fixed
   1024×1024 transparent canvas → WebP, plus a 256px thumbnail.

Per the spec, both `original_image_key` and `processed_image_key` are stored, plus a
`processing_status` so the UI can show a pending state.

**Hard requirement:** the user can always override with a manual crop or accept the original
image. No segmentation model is reliable enough to be a blocking dependency.

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
│   ├── stats/                wear-stats.ts · cost-per-wear.ts · neglected.ts
│   └── validation/           (zod schemas, shared client + server)
├── jobs/                     process-item-image.ts
├── prisma/                   schema.prisma · migrations/
├── prisma.config.ts          connection URLs for migrations (Prisma 7 moved these out of the schema)
└── tests/
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
| **0 — Foundation** ✅ *local scaffold done* | Next.js + Tailwind + theme tokens, full Prisma schema, Supabase client helpers, pure-function core (`signature`, `cost-per-wear`, `neglected`). Remaining: Supabase project + first migration + auth UI + Vercel deploy (see `SETUP.md`) | Empty app is live and login works |
| **1 — Catalog (raw)** | Photo/screenshot upload → storage, item metadata form, tags, grid view, edit/delete, **hanger/dress-form photography guidance in the capture flow**. **No image processing yet** | Real closet can be loaded in, unprocessed |
| **2 — Image pipeline** | Inngest job, segmentation, per-category normalization, pending/failed UI states, manual override, backfill of Phase-1 items | Catalog looks visually uniform |
| **2.5 — Mannequin calibration** | Time-boxed ~1 day. Source or commission the neutral mannequin asset; composite ~10 real garments over it; tune per-category anchor boxes and shadow treatment until a full outfit reads correctly | The outfit visual is proven on real garments before the builder is built around it |
| **3 — Browse & item detail** | Filters (category / color / brand / formality / sleeve), search, brand jump-through, item detail page *minus* wear stats | Catalog is genuinely navigable at ~100 items |
| **4 — Outfit builder** | Mannequin-backed composite layout, per-slot carousels, live preview, per-item scale/offset adjustment, save / name / tag, signature + duplicate detection, edit-in-place (new `OutfitVersion`) + duplicate | Real outfits can be built and saved |
| **5 — Wear tracking** | Log worn (today or backdated), outfits or loose items; **optional OOTD photo per wear** (option A — manual override/fallback); calendar month/week, image-first cells showing the rendered outfit per day | Daily logging habit starts; calendar matches the reference aesthetic |
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
| 4 | On-body rendering approach | **D (mannequin-backed layered composite).** Garment accuracy outranks on-body realism, which rules out generative approaches. A retained as an optional per-wear photo; B and C not planned | Resolved 2026-08-31 |
| 5 | Mannequin asset — source or commission? | Needs one neutral, faceless, front-facing figure. Stock 3D render, illustration, or commissioned asset all work. Decide at Phase 2.5; not blocking before then | Open — gated to Phase 2.5 |

Decision 5 is cosmetic and does not block Phases 0–2.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-31 | Initial plan drafted from `closet_app_feature_spec.md` |
| 2026-08-31 | Open decisions 1–3 resolved. Outfit editing = edit-in-place carrying history; data model gains `OutfitVersion` and `WearLog.outfitVersionId` to keep exact-combination stats accurate. Supabase confirmed; single-user confirmed. Spec §2 and §3 updated to match. |
| 2026-08-31 | Design direction added (Everlane/COS/Indyx references) → new spec §5, new plan Design Direction section, theme tokens added to Phase 0. On-body rendering evaluated → new spec §6, new plan §1.2; option A (OOTD photo capture) added to Phase 5 and spec §3, option B deferred to Phase 7 pending decision 4, option C ruled out. `WearLog` gains OOTD image fields; `ImageJob` made polymorphic. |
| 2026-08-31 | **Correction + scope change.** The travel-app reference is composited/rendered, not mirror selfies — the two reference screenshots showed different techniques and had been conflated. Goal restated as "me in varied poses per outfit, without photographing each outfit," which is option B. B promoted from deferred Phase 7 experiment to **primary direction**; A demoted to manual override/fallback. Added pose library (`UserPhoto`), render cache (`OutfitRender`), deterministic pose assignment, and a **Phase 2.5 quality spike** gating the Phase 4 builder design. Spec §6 rewritten. |
| 2026-08-31 | **Phase 0 scaffolded locally.** Actual toolchain versions differ from what this plan originally specified and are corrected above: **Next.js 16.3** (not 15 — Turbopack is now the default, request APIs are async-only, `middleware` is renamed `proxy`), **Tailwind v4** (CSS-first `@theme`, no `tailwind.config.ts`), **Prisma 7** (connection URLs moved from `schema.prisma` to a new `prisma.config.ts`; the client now requires a driver adapter, `@prisma/adapter-pg`). Node 26.8.1 installed via Homebrew. Note `npm i -D prisma` resolves to an 8.0 release candidate with an entirely different CLI — the dependency is pinned to `prisma@7` to match `@prisma/client`. |
| 2026-08-31 | **Direction settled: garment fidelity outranks on-body realism.** New approach **D** (mannequin-backed layered composite) becomes the primary outfit visual — real garment cutouts layered over a neutral static mannequin figure with per-category anchors, contact shadows, and per-item scale/offset overrides. **B dropped** (generative = garment drift); `UserPhoto` and `OutfitRender` removed from the data model; `Item` gains `layoutScale`/`layoutOffset`. Phase 2.5 repurposed from try-on spike to mannequin calibration. Hanger/dress-form photography guidance added to spec §1 and Phase 1 — intake quality drives outfit-view quality more than the renderer does. Spec §1, §2, §6 updated. |
