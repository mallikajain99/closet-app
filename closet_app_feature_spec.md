# Digital Closet Manager — Feature Specification

## Overview
A personal wardrobe management app that catalogs clothing/shoes, lets the user build and save outfits with a visual "on-body" layout, tracks wear frequency, and calculates cost-per-wear.

---

## 1. Clothing & Shoe Catalog

- **Item intake methods:**
  - Photo upload (taken by user)
  - Link/URL import (scrape product image from a retailer link)
  - Screenshot upload (from websites, social media, etc.)
- **Recommended photography (materially affects outfit-view quality):** shoot garments on a hanger
  or dress form rather than flat on a surface. A flat-lay has no dimension and reads as a flat
  sticker when composited into the outfit view; a hung or formed garment retains shoulders, drape,
  and interior shadow and composites convincingly. Cutouts taken from retailer model shots are
  similarly good source material. The app should surface this as guidance in the capture flow, not
  enforce it. Rough ranking of source quality:
  **dress form / hanger › retailer model shot › self-worn photo › flat-lay**
- **Self-worn photos as item sources:** usable, and better than a flat-lay because the drape is
  real, but they make the person-removal step harder and can fail in ways that persist forever in
  the outfit view. Guidance to surface when the user picks this route: arms away from the body,
  the garment untucked and fully visible, one layer at a time (not shot under a jacket), plain
  background, straight on. Failure modes to expect otherwise — crossed arms and loose hair leave
  holes or attached skin in the cutout; a tucked hem simply isn't in the photo, so the garment
  renders permanently cropped; a bent arm yields a bent sleeve.
- **A worn *outfit* photo is not an item source.** Individual garments cannot be reliably separated
  out of it — each piece is partly occluded by the others. Full-outfit photos belong to wear
  logging instead (Feature 3, and §6 approach A), where they are kept whole as the record of a
  day's wear.
- **Automatic image processing pipeline (runs on every submitted item):**
  - Remove background from the photo
  - If the source is a model/lifestyle photo, isolate and remove the person, keeping only the garment
  - Normalize the result into a consistent style across the whole catalog (e.g., same canvas size, same neutral background color/transparency, similar centering/scale) so every item looks visually uniform regardless of source
  - Store both the original source image and the processed "clean" version
  - **Runs in the background, not in front of the user.** Saving an item returns
    immediately and the item is usable straight away, showing its source photo until the
    clean version is ready. The catalog marks an item as still processing, and marks one
    whose processing failed — a failure is never silent and never blocks the item.
  - **The user can override the result.** Any item can have its cutout re-run, or can be
    told to keep the original photo instead. Keeping the original is a permanent choice
    that later bulk re-runs leave alone.
- **Typed text is normalized on save, whatever the casing.** Item titles become sentence case
  with brand names left in their own spelling (COS, ba&sh) and letter-shape terms keeping their
  capital (V-neck, A-line); tags snap to a spelling already in use, so "Work" and "work" stay
  one tag rather than splitting the items between two. Brands, sizes, subcategories, materials
  and patterns already worked this way — this extends it to the two places that still drifted.
- **Item metadata (manually entered or inferred).** Fields that don't apply to a category are
  not offered: a handbag has no sleeve length, a necklace has no silhouette, and neither has a
  size. The form hides them as soon as a category is chosen, and the server drops any value for
  an inapplicable field — so changing an item's category later can't leave a stale attribute
  attached. Silhouette *suggestions* are also category-specific ("wide-leg" for bottoms, not
  blouses), though the vocabulary stays open to anything typed.
  - Category (top, bottom, dress, outerwear, shoe, hat, accessory, etc.)
  - Subcategory (t-shirt, blouse, jeans, sneakers, heels, etc.)
  - Color(s)
  - Brand
  - Size
  - Season/weather suitability (optional but useful — see suggestions below)
  - Purchase price (for Feature 4)
  - Purchase date / source link
  - Descriptive attribute tags — e.g. sleeve length (short/long/sleeveless/strapless), silhouette, formality (casual/simple/fancy/dressy), material, pattern
  - Custom freeform tags/categories (e.g. "work," "going out," "date," "favorite") — the same tag set used to categorize outfits, so an item can independently show which categories it's associated with
- **Catalog browsing:**
  - Grid/gallery view, filterable by category, color, brand, tag, formality, sleeve length, etc.
    - **Colour filters on families, not on the written colour.** Items keep the colour actually
      typed — "espresso", "moss green", "oatmeal" — because that is the useful description on an
      item page. As a filter it collapses: 49 items produced 28 distinct colours, most of them
      appearing once, so nearly every chip matched a single garment. Filtering groups those into
      about a dozen families shown with a colour swatch, while the specific colour is preserved
      wherever it is displayed
  - Search bar (including search by brand)

### Item Detail View
Clicking any single item (e.g., a specific top) in the catalog opens a detail page showing:
  - The processed/clean visual of the item
  - Wear stats: lifetime wears, wears in last 7 days / 30 days / 60 days / year (and custom range), last worn date
  - Neglected flag if not worn in 60+ days / 2 months (configurable threshold). For an item that has **never** been worn, the clock starts from the date it was added to the catalog — so a newly added item is flagged only after 2 months in the closet without a wear, rather than immediately
  - All categories/tags it's linked to (e.g. "Work," "Going Out," "Date")
  - Brand (and a way to jump to "see all items from this brand")
  - Descriptive attribute tags (color, sleeve length, formality, material, pattern, etc.)
  - Cost-per-wear: original purchase price ÷ lifetime wear count
  - List of outfits this item currently belongs to (with the ability to jump into any of them)
  - **"Build an outfit" — opens the builder with this garment already in its slot.**
    An outfit is rarely conceived from an empty builder; it starts from one piece the
    user has in mind, and the item's own page is where they are standing when they think
    of it. Arriving preselected skips hunting the same garment back out of a strip of
    every top in the closet
  - **Deleting an item is never blocked by the outfits that contain it.** The item is
    removed from each of them and the outfit survives as its remaining pieces; an outfit
    left with nothing in it is deleted too. Refusing the delete would make the outfits
    the authority over the closet, when the closet is what actually exists — and it left
    the user unable to remove a garment they no longer own. Auto-generated outfit names
    that mentioned the departed item are rewritten from what remains

---

## 2. Outfit Builder

- **Visual "virtual mannequin" layout:**
  - Fixed vertical arrangement mimicking body position: hat/head accessory → top → outerwear layer (if applicable) → bottom → shoes, with bags/jewelry/other accessories positioned logically around the frame
  - **A bag hangs beside the figure, not in the stack.** It is carried, not worn, and a
    handbag centred between hem and shoes reads as a garment — a third layer of the
    outfit rather than an accessory to it. Bags sit at hip height against the right edge
  - **Two layers on the same shoulder line are spread apart, not stacked.** Worn, a
    cardigan covers most of the shirt under it — accurate, and useless: the outfit reads
    as one garment and the piece underneath may as well not be in it. The outer layer is
    laid off to one side so the two overlap rather than hide, as flat-lay styling does
  - **A layered top and outerwear are drawn at a matched shoulder width.** Garment
    heights come from body landmarks, so a garment's *width* is whatever its
    photograph's aspect ratio makes it — across a real closet that ranges by a factor of
    nearly three, and the narrower of two layers ends up looking like a different size
    of clothing. They are scaled to a common shoulder width around the shoulder line, so
    the hem moves and the anchor does not
  - **Shoes stand under the hem, not on the trouser leg.** Anatomically the trouser
    breaks over the shoe, so a floor-anchored shoe sits largely behind the hem; with no
    leg drawn behind it, that reads as a shoe stuck to mid-calf. The overlap is capped at
    a token amount that still reads as contact
  - **Garments are scaled and anchored as if worn** (see §6, approach D) — per-category anchor boxes sized against a nominal body, with soft contact shadows separating the layers, rather than cutouts stacked at arbitrary sizes. A neutral digital mannequin figure can be rendered behind them to fill the gaps between pieces with exposed arms, neck and legs; it is an optional back layer, deferred until the catalog has full head-to-toe outfits where those gaps appear
- **Item selection UX:**
  - Horizontal scroll/carousel for each clothing slot (e.g., scroll through all tops, then scroll through all bottoms, then all shoes, then optional accessories/hats)
  - **Within a slot, items are grouped by kind** — all the jeans together, then the
    trousers, then the skirts — each group under its own label. One undifferentiated row
    of 38 tops is a scrolling problem, not a choosing one; the user knows what *kind* of
    thing they want before they know which one
  - As the user scrolls/selects in each row, the mannequin-style preview updates live so they can see the full outfit assembled before saving
- **Outfit saving & organization:**
  - Save assembled outfit as a named entity
  - **The name is written for the user, not requested from them.** An outfit is named
    automatically from the pieces in it — "Sage green sweater + black jeans" — and the
    field is pre-filled rather than blank, so saving is one tap. The user can overwrite it
    at any time and the app never overwrites their wording afterwards. Naming is the only
    part of saving an outfit the app can't infer well enough to demand, and demanding it
    turns a two-tap action into a writing task
  - **Names stay in sync with the garments.** Renaming or recolouring an item updates the
    auto-named outfits that mention it; an outfit the user named themselves is left alone.
    Two outfits can't end up with the same name — a collision takes a more specific
    variant (naming the third piece) rather than a numeric suffix
  - **Photos of the outfit on a body — the outfit's primary visual.** An outfit can carry any
    number of full-body photos of the user wearing it, added when the outfit is created or at
    any time afterwards. **These are not a wear log and are not tied to a date**; they exist so
    the outfit can be seen on a body rather than as stacked cutouts. Where an outfit has a
    photo, that photo *is* how the outfit is shown — in the outfit list, on its detail page, and
    in any calendar day it was worn. The layered composite (§6 approach D) is the fallback for
    outfits that have not been photographed
  - This is the honest answer to the goal in §6 — seeing real clothes on a real body. A
    photograph of the user in the outfit is perfectly accurate by construction, where every
    rendered approach is an approximation. Photographing an outfit once covers it forever
  - Assign one or more categories/tags (e.g., "Work," "Date Night," "Going Out," "Gym")
  - **The saved-outfit list filters by occasion tag**, the same URL-backed chip row the
    catalog uses, with counts taken from the unfiltered set so the chips keep their
    numbers while narrowing. "What can I wear to work" is the question the tags exist to
    answer, and it needs asking from the list rather than one outfit at a time
  - Ability to edit a saved outfit later (swap out one piece) — **the outfit keeps its name, tags, and full wear history through the edit.** It remains the same outfit, not a new one; see the outfit identity rule in Feature 3 for how this interacts with exact-combination stats
  - Ability to duplicate an outfit as a starting point for a new one (the duplicate starts with a fresh, empty wear history)

---

## 3. Wear Tracking & Analytics

- **Logging wear:**
  - **A wear is a calendar day, not an event.** Logging the same item twice for one date does not count twice — a repeat tap joins that day. Otherwise cost-per-wear drifts down with every stray tap, and it is the number the app exists to report. Wears can be backdated freely but never forward-dated.
  - Mark an outfit (or individual items, if worn outside a saved outfit) as "worn today" — or backdate to a past date
  - **Retroactive wear logging is a first-class action, not an edge case.** Occasion pieces — a formal dress worn to a wedding last spring — are worn rarely and unpredictably. The user must be able to add a past wear date directly from an item's detail page (not only through the calendar), so genuinely-worn items can be corrected out of the neglected list. Adding a past wear updates last-worn date, lifetime count, and cost-per-wear exactly as a same-day log would
  - **Per-wear OOTD photos are not in scope** (revised 2026-09-19). The original plan was to
    attach a photo to each individual wear, as a photographic record of that day. That is a
    diary, and the goal here is not a diary — it is seeing an outfit on a body, which an
    outfit-level photo already does. Requiring a photo every morning also guarantees the
    feature goes unused
  - **What a calendar day shows:** the outfit's photo where it has one, otherwise the outfit's
    composite, otherwise the garment cutouts for a day of loose items. The photo is not a
    record of that day and may well have been taken later — it is simply the best picture of
    what was worn
- **Calendar view:**
  - Each day shows a thumbnail/visual of the outfit worn (if any) — the outfit's photo when it has one, otherwise the assembled mannequin-layout composite of the outfit's items
  - **The composite shows every piece, at composite proportions** — not a grid of
    thumbnails. A capped grid silently drops garments from a larger outfit, and the day a
    five-piece outfit shows four is the day the calendar stops being trustworthy
  - **A day in a saved outfit shows, and opens, that outfit as it stands now** — not the
    version that was logged. The wear keeps its own snapshot so exact-combination stats
    stay honest (see *Edited outfits*), but the cell is labelled with the outfit's name
    and links to the outfit, so rendering a superseded version makes the picture disagree
    with where it goes: add shoes to an outfit and every day already logged loses them.
    A day of loose items opens the first garment instead
  - Month view and week view
- **Dashboard / stats view:**
  - **Time windows use calendar periods, not rolling ones, for month and year.** "August" means August 1–31, not the last 30 days. A rolling window moves its own boundaries daily, so the same number means something different each time it's read; a calendar month is something the user can actually reason and recall against. Short windows ("last 7 days") stay rolling, where that genuinely is the intent
  - Per outfit: lifetime wear count, wears this month / this year / custom range, last worn date
  - Per individual item: lifetime wear count, wears this month / this year, last worn date, which outfits it's been part of
  - "Neglected items" view — surface items/outfits not worn in X days to encourage rotation
  - Passive visual marker (badge/dimmed thumbnail/colored border) directly on each item or outfit tile in the catalog and dashboard when it hasn't been worn in a configurable threshold (e.g., 60 days) — a glanceable flag, not a push notification
  - "Most worn" / "least worn" leaderboard
- **Outfit Detail View:**
  - Clicking a saved outfit opens a detail page showing the full assembled visual (mannequin-style layout)
  - Below/alongside it, the same per-item stat breakdown from the Item Detail View is shown individually for each piece in that outfit (each item's own lifetime wears, recent wear counts, neglected flag, categories, cost-per-wear, etc.) — so the user can see, at a glance, how each individual piece is performing even within the context of this one outfit
  - Outfit-level stats also shown separately: lifetime wears of this exact outfit combination, wears in last week/month/year, last worn date. If the outfit has been edited, the all-versions total is shown alongside it (see *Edited outfits* below)
- **Outfit identity rule (important):** An "outfit" is defined as the exact, specific combination of items saved together. Re-wearing one piece (e.g., the same jeans) with a different top/shoe combination counts as a *different* outfit, not a repeat. Wear-frequency and "neglected" logic at the outfit level must only track exact combination matches — it should never flag "you keep rewearing this outfit" just because one shared item (like a pair of pants) appears across multiple distinct outfits. Item-level reuse and outfit-level reuse are tracked completely separately.
- **Edited outfits (clarification to the rule above):** Editing a saved outfit (swapping one piece) does **not** create a separate outfit — the outfit keeps its identity and its accumulated wear history. To keep this consistent with the exact-combination rule, each saved arrangement of items is a *version* of the outfit, and every wear is logged against the specific version worn. The outfit detail view therefore shows two clearly-labeled numbers:
  - **Wears of this outfit** — across all versions, the continuous history of the look
  - **Wears of this exact combination** — the current version only, satisfying the identity rule above
  The "you wore this exact combo recently" warning under *Suggestion assist* matches on exact combination only, never on the broader all-versions count.
- **Suggestion assist:**
  - Optional: when building a new outfit, flag if the exact same combination was worn very recently (based on the outfit identity rule above, not shared individual pieces)

---

## 4. Cost-Per-Wear Tracking

- Input purchase price per item (already captured in catalog metadata)
- Auto-calculate cost-per-wear = purchase price ÷ lifetime wear count (updates as wear count increases)
- **Never-worn items display their full purchase price as the cost-per-wear**, not a blank. That is precisely what the item will cost per wear the first time it's worn, and it reads more intuitively than an empty value — a $200 coat you haven't worn yet is a $200-per-wear coat. A blank/em-dash is shown only when no price was recorded at all
- **Outfit cost-per-wear = the sum of its items' individual cost-per-wear values.** Each garment earns its cost down independently through everything it's worn with, and an outfit inherits whatever each piece currently costs. This is deliberately *not* "total outfit price ÷ times this outfit was worn" — that formula would make a brand-new combination of well-worn favorites look expensive, which inverts the truth. If any item in the outfit has no recorded price, the outfit figure is a lower bound and must be labeled as partial rather than shown as exact
- Sort/filter catalog by cost-per-wear (find your "best value" and "worst value" pieces)
- Optional: total closet value, total spend by category/brand/season

---

## 5. Visual Design Direction

**Principle: clean and simple — let the clothes shine.** The interface should read as a quiet
gallery for the garments, never competing with them.

Reference points (provided 2026-08-31): **Everlane** and **COS** product grids for the catalog;
**Indyx** and similar wardrobe apps for the calendar.

- **Imagery leads.** Item images are large, uncropped, and edge-to-edge in the grid. Metadata sits
  quietly beneath — name, then brand, then supporting stats — never overlaid on the garment
- **Neutral, warm-toned canvas.** Off-white/cream backgrounds rather than pure white or dark
  chrome. Item images share one consistent background treatment (per the normalization pipeline in
  Feature 1), so the grid reads as a single coherent set
- **Minimal chrome.** Separation comes from whitespace and image edges, not borders, cards, or
  drop shadows
- **Restrained typography.** Light-weight sans-serif; small uppercase letter-spaced labels for
  navigation and metadata; generous line height
- **Color is reserved for signal.** The palette is essentially neutral, so the few colored
  elements — the neglected-item marker, cost-per-wear highlights, laundry status — carry real
  meaning by contrast
- **Adjustable grid density.** A control to switch between a few large tiles and a dense
  many-per-row view (as COS offers), since browsing a closet and scanning it are different tasks
- **Calendar cells are image-first.** Each day is filled by its outfit visual with the date number
  small in the corner; empty days stay genuinely empty rather than showing placeholder chrome

---

## 6. On-Body Rendering (Avatar)

**Goal:** see outfits on a representation of the user rather than as a flat layout.

Three approaches were evaluated on 2026-08-31, in ascending order of difficulty:

**The target look (clarified 2026-08-31):** the same person, in varied natural poses, wearing each
saved outfit — **without having to photograph themselves in every outfit.** Note that two different
things appear in the reference screenshots and should not be conflated: the Indyx-style calendar is
self-photographed mirror selfies (the phone is visible in hand), whereas the travel-app cards show
front-facing, evenly-lit, varied-pose figures that are composited/rendered rather than
self-photographed. The latter is the goal.

**A. OOTD photo capture — in scope, but not the goal.** The user photographs themselves wearing
the outfit; the image is background-removed and becomes that day's calendar visual. Reuses the
existing image pipeline entirely and is always perfectly accurate, since it is a real photograph.
Two limitations: it requires photographing every outfit, and it is retrospective — it cannot preview
an outfit that hasn't been worn. Retained as a always-available manual option and as the fallback
when generation is unavailable or looks wrong.

**B. 2D virtual try-on with a pose library — evaluated and set aside (see Decision below).**
The user uploads a small set of full-body reference photos of themselves (roughly 5–8, varied pose
and angle) **once**. Saved outfits are then rendered onto those photos automatically, with each
outfit deterministically assigned a pose so it is stable for that outfit but varies across the
calendar — producing the lookbook effect in the reference screenshot.

  - Multiple poses adds no technical difficulty: each generation is independent, so a pose library
    is simply N× the generations
  - The real difficulty is **complete outfits**. Dedicated try-on models (IDM-VTON, CatVTON, Leffa)
    handle one garment per pass at high garment fidelity, so an outfit requires chained passes with
    compounding artifacts; shoes render poorly and bags/jewelry largely do not work. General
    image-editing models (Flux Kontext, Gemini-class) can compose a full outfit in one pass but with
    lower garment fidelity — they may subtly redraw patterns, shift colors, or invent details
  - **Required fidelity varies by surface,** which is what makes this tractable: a ~100px calendar
    cell needs only silhouette and color to read correctly, while the outfit detail view is where
    the user actually inspects garments and where the mannequin composite must remain available
  - Generation takes roughly 10–40s and costs per call, so it runs on outfit save and is cached —
    never live while scrolling the builder carousels

**C. True 3D avatar with cloth simulation — out of scope.** Body reconstruction from photos is
largely solved; the blocker is the garments. A flat product photo does not contain a garment's 3D
shape, and producing simulation-ready meshes from single images remains an open research problem,
so every item would need a bespoke 3D asset authored as a sewing pattern. Reference renders of
neutral 3D mannequins wearing clothes (Magnopus and similar) are produced this way — they are
constructed 3D garments, not photographs — which is why that exact look is not reachable from a
photo-based catalog. Specialist, multi-person effort; not a feature of this app.

**D. Layered composite — the chosen direction (decided 2026-08-31; amended 2026-09-18).**
Real garment cutouts are layered in correct z-order, scaled and anchored **as if worn** rather
than stacked at arbitrary sizes.

A neutral digital mannequin figure may be rendered behind them, and originally this was the
mechanism. It isn't: the *geometry* is what makes an outfit read correctly, and the figure is a
single optional layer behind it. Judged against real garments on 2026-09-18, a one- or
two-piece outfit reads better without one — cleaner, and truer to the "let the clothes shine"
direction in §5. A figure earns its place when an outfit has gaps to fill (top + bottom +
shoes, where exposed arms, neck and legs bridge the pieces), so the decision is deferred until
the catalog contains those. Turning it on is one layer, not a rework.

  - **Garments stay pixel-accurate** — they remain the user's own processed photographs, never
    regenerated or redrawn. This is the deciding requirement: accurate clothes matter more than
    being shown on a likeness of the user
  - Per-category **anchor boxes** position and scale each garment, expressed relative to a
    nominal body height so the same geometry holds with or without a figure drawn; soft contact
    shadows between layers separate top from bottom from outerwear
  - **Per-item manual adjustment:** the user can nudge an item's scale and offset once; the
    adjustment is stored on the item and applies in every outfit containing it. This handles
    long-tail pieces (dusters, crop tops, oversized outerwear) that generic category anchors place
    poorly
  - **Source photography drives quality more than the renderer does.** A flat-lay photo has no
    dimension and will read as a sticker regardless of layering. Garments photographed on a dress
    form or hanger — or cut from retailer model shots — retain shoulders, drape, and interior
    shadow, and composite convincingly. The intake guidance in Feature 1 should recommend
    hanger/dress-form photography as the default for this reason
  - **Realistic expectation:** a well-styled outfit arranged on a body form. Clearly better than
    floating cutouts; not equivalent to a true 3D render, since a photographed garment cannot
    reshape itself to the mannequin's pose

**Decision:** **D is the primary outfit visual.** A (OOTD photo capture) is retained as an optional
manual per-wear photo. **B is not planned** — it was the primary direction briefly, but it trades
garment fidelity for on-body realism, and garment fidelity is the higher priority. C remains out of
scope. B's analysis is retained above should the trade-off ever be worth revisiting.

---

## Suggested Additional Features to Consider

These aren't in your original list but fit naturally given the data you'll already be capturing:

1. **Weather & occasion-aware suggestions** — pull local weather and suggest outfits appropriate for the temperature/conditions, using the season/weather tags on items.
2. **"Surprise me" / random outfit generator** — auto-assemble a valid outfit from underused items, directly addressing your stated goal of breaking out of repetition ruts.
3. **Laundry/cleaning status** — mark an item as "in the wash" or "at the cleaners" so it's excluded from outfit suggestions until available again.
4. **Packing lists for travel** — select a date range and destination weather, build a mini-wardrobe/packing list from your catalog.
5. **Wardrobe gap analysis** — e.g., "you have 12 tops but only 2 bottoms that go with them" or "you have no warm outerwear."
6. **Declutter/resale tracking** — flag items you're considering donating or selling, especially ones with high cost-per-wear or that haven't been worn in a long time.
7. **Neglected-item visual marker (no notifications)** — on the dashboard/catalog, items or outfits that haven't been worn in a configurable threshold (e.g., 60 days) get a passive visual indicator (e.g., a badge, dimmed thumbnail, or colored border) rather than a push notification — a glanceable flag you notice when browsing, not an alert.
8. **Fit/condition notes** — track items that need mending, no longer fit, or are showing wear, so they're excluded from suggestions.
9. **Return-window tracker** — for online purchases, flag items still within a store's return period until you've confirmed you'll keep them.
10. **Multi-person/shared closets** — if useful later, support more than one wardrobe profile (e.g., partner, family member) in the same app.
11. **Export/backup** — download your catalog and wear history as a spreadsheet or JSON in case you switch apps someday.
12. **Outfit history search** — "What did I wear the last time I went on a date?" style lookback, useful for not repeating an outfit in front of the same people/occasion.

---

## Technical Notes for the Implementing AI

- **Background/model removal:** This is the trickiest technical piece. Options include an image-segmentation service or library (e.g., a background-removal API/model) run server-side whenever an item is submitted; for model photos specifically, a person-segmentation step is needed before isolating the garment. This should be flagged as a distinct pipeline step so the implementer can pick the right tool for it.
- **Suggested core data model entities:** `Item` (with `original_image`, `processed_image`, category, metadata, price), `Outfit` (stable identity: name + category tags) with `OutfitVersion` (one exact ordered set of Item references; a new version is created on each edit), `WearLog` (date, outfit_id + outfit_version_id, or list of item_ids), `Tag`/`Category` (for both items and outfits). See `PLAN.md` for the full schema.
- **Mannequin layout:** Can be implemented as a fixed-position visual template (CSS/layout slots for hat/top/outerwear/bottom/shoes/accessories) where each slot renders the selected item's processed (background-removed) image — no actual 3D or skeletal mannequin needed.
- **Platform (decided 2026-08-31):** Mobile-first responsive **web app**, installable as a PWA. Camera capture is handled via `<input type="file" accept="image/*" capture="environment">`. Stack, architecture, and build order are specified in `PLAN.md`.
- **Scope (decided 2026-08-31):** Single-user for now. Multi-person/shared closets (suggestion #10) is deferred but designed for — every record carries a user reference from the start.
