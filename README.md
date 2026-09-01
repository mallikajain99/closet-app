# Closet

A personal wardrobe manager: catalog your clothes, build outfits on a digital mannequin, track
what you wear, and see what each piece actually costs per wear.

- **[closet_app_feature_spec.md](./closet_app_feature_spec.md)** — what the app does
- **[PLAN.md](./PLAN.md)** — architecture, data model, and build order
- **[SETUP.md](./SETUP.md)** — Supabase and Vercel setup, step by step

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Prisma 7 · Supabase (Postgres, Storage, Auth)

## Getting started

Requires Node 20.9+.

```bash
npm install
# Create .env.local — template and instructions in SETUP.md §4
npx prisma migrate dev --name init
npm run dev
```

Open [localhost:3000](http://localhost:3000).

```bash
npm test          # run the suite once
npm run test:watch
```

## Layout

```
app/          routes (App Router)
components/   UI, grouped by feature
lib/          business logic — framework-free and unit-testable
  outfits/    signature.ts — the outfit identity rule
  stats/      cost-per-wear.ts, neglected.ts
  supabase/   server + browser clients
  db.ts       Prisma client
prisma/       schema.prisma, migrations
```

`lib/` holds no framework imports on purpose: the outfit-identity, cost-per-wear, neglected, and
wear-window rules are the logic most likely to be subtly wrong, so they're testable without a
database or a browser. `tests/` mirrors that structure.

## Notes

- **Prisma 7** keeps connection URLs in `prisma.config.ts`, not `schema.prisma`, and connects
  through a driver adapter. Migrations use `DIRECT_URL`; the app uses the pooled `DATABASE_URL`.
- **Installing Prisma:** pin to `prisma@7`. Plain `npm i -D prisma` currently resolves to an 8.0
  release candidate with a different CLI.
- **Tailwind v4** is CSS-first — design tokens live in `app/globals.css` under `@theme`, and there
  is no `tailwind.config.ts`.
