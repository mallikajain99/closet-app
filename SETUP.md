# Setup — Supabase & Vercel

Step-by-step for the accounts and services Phase 0 needs. Work through these while the local
scaffold is being built; nothing here depends on the code existing yet **except** the Vercel
import at the end.

Keep every secret in `.env.local` (already gitignored). Never commit one.

---

## Part 1 — Supabase (do this first)

Supabase provides the Postgres database, file storage, and auth.

### 1.1 Create the project

1. Go to **[supabase.com](https://supabase.com)** → **Start your project** → sign in with GitHub
2. **New project**, then set:
   - **Name:** `closet-app`
   - **Database password:** click Generate, then **save it in your password manager immediately** —
     it is shown only once and is needed for the database connection string
   - **Region:** **East US (North Virginia)** — closest to Philadelphia, and matches Vercel's
     default region, which keeps query latency low
   - **Plan:** Free
3. Click **Create new project** and wait ~2 minutes for provisioning

> **Free tier note:** projects pause after ~1 week with no activity. Un-pausing is one click in the
> dashboard, but it's worth knowing before you wonder why the app broke after vacation.

### 1.2 Collect the connection strings

Go to **Project Settings → Database → Connection string**. You need **two**, and the difference
matters:

| Which | Port | Used for | Env var |
|---|---|---|---|
| **Transaction pooler** | `6543` | The running app. Serverless functions open many short-lived connections and will exhaust Postgres without a pooler | `DATABASE_URL` |
| **Direct connection** | `5432` | Prisma migrations only. Schema changes can't run through a pooler | `DIRECT_URL` |

Copy both. Replace `[YOUR-PASSWORD]` in each with the password from step 1.1.

Append `?pgbouncer=true&connection_limit=1` to the **pooled** URL — Prisma needs this to behave
correctly behind PgBouncer.

### 1.3 Collect the API keys

Go to **Project Settings → API** and copy three values:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`. Use the **bare origin only** —
  `https://<project-ref>.supabase.co`, with no path and no trailing slash. The API settings
  page lists the REST endpoint (`.../rest/v1/`) alongside it and it's easy to grab by
  mistake; the client library appends every path itself, so a path here produces
  `Invalid path specified in request URL` at sign-in
- **`anon` / publishable key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe in the browser)
- **`service_role` / secret key** → `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ The `service_role` key bypasses all row-level security. Server-side only — never in a
> `NEXT_PUBLIC_*` variable, never in client code.

### 1.4 Create the storage buckets

Go to **Storage → New bucket** and create two, **both with "Public bucket" turned OFF**:

| Bucket | Contents |
|---|---|
| `closet-originals` | Unmodified uploads — source photos, screenshots, imported product images |
| `closet-processed` | Background-removed, normalized garment images and thumbnails |

Private buckets mean images are served through short-lived signed URLs rather than being
world-readable. Your wardrobe and purchase history shouldn't be publicly enumerable.

### 1.5 Enable email auth

1. **Authentication → Providers → Email** — confirm it's enabled (it is by default)
2. Turn **off** "Confirm email" for now. Single-user app, and it removes a round trip during
   development. Turn it back on if the app ever has other users
3. **Authentication → URL Configuration** → set **Site URL** to `http://localhost:3000` for now.
   You'll add the Vercel URL here after Part 2

---

## Part 2 — GitHub

Vercel deploys from a Git repository, so the local repo needs a remote.

1. Create a **private** repo at **[github.com/new](https://github.com/new)** named `closet-app`.
   Do **not** initialize with a README, `.gitignore`, or license — the local repo already has
   commits and those would conflict
2. Connect and push:

```bash
git remote add origin https://github.com/YOUR-USERNAME/closet-app.git
git push -u origin main
```

If you have the GitHub CLI, this does both steps at once:

```bash
gh repo create closet-app --private --source=. --remote=origin --push
```

---

## Part 3 — Vercel

Do this **after** the Phase 0 scaffold exists and is pushed — Vercel needs a Next.js app to detect.

### 3.1 Import

1. Go to **[vercel.com](https://vercel.com)** → sign in **with GitHub**
2. **Add New → Project** → find `closet-app` → **Import**
3. Framework preset should auto-detect as **Next.js**. Leave build settings alone

### 3.2 Environment variables

Before the first deploy, expand **Environment Variables** and add all of these. Apply each to
**Production, Preview, and Development**:

```
DATABASE_URL                     # pooled, port 6543, with ?pgbouncer=true&connection_limit=1
DIRECT_URL                       # direct, port 5432
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

These come later, when their phases land — add them then rather than now:

```
REPLICATE_API_TOKEN              # Phase 2, image pipeline
INNGEST_EVENT_KEY                # Phase 2, background jobs
INNGEST_SIGNING_KEY              # Phase 2, background jobs
```

### 3.3 Deploy, then close the auth loop

1. Click **Deploy** and wait for the build
2. Copy the deployment URL (`https://closet-app-....vercel.app`)
3. Back in **Supabase → Authentication → URL Configuration**:
   - **Site URL:** the Vercel production URL
   - **Redirect URLs:** add both `http://localhost:3000/**` and `https://your-app.vercel.app/**`

Skipping step 3 is the usual cause of login redirecting to the wrong place or failing silently.

---

## Part 4 — Local environment file

Create `.env.local` in the project root (gitignored — it will never be committed):

```bash
# Database
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

Then apply the schema:

```bash
npx prisma migrate dev --name init
npx prisma studio          # browse the empty tables to confirm it worked
```

---

## Checklist

- [ ] Supabase project created, database password saved
- [ ] Pooled + direct connection strings copied
- [ ] API keys copied (URL, anon, service_role)
- [ ] Buckets `closet-originals` and `closet-processed` created, both **private**
- [ ] Email auth enabled, confirm-email off, Site URL set
- [ ] GitHub repo created and `main` pushed
- [ ] `.env.local` filled in locally
- [ ] `prisma migrate dev` run successfully
- [ ] Vercel project imported with env vars set
- [ ] Supabase Site URL + redirect URLs updated with the Vercel domain
