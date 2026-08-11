# Ringo Connect

Link-in-bio + social commerce platform. Public profile with Links / Catalog / About
tabs, a creator editor, a WhatsApp click-to-chat button throughout, and a Super
Admin dashboard for managing creators and plan tiers.

## Stack
Next.js 14 (App Router) · Supabase (Postgres, Auth, Storage, RLS) · Tailwind CSS ·
Recharts · react-icons

## Getting started

1. **Create a Supabase project** at supabase.com.
2. **Run the schema** — open the SQL editor in your Supabase dashboard and run
   the contents of `supabase/schema.sql`. This creates all tables, seeds the
   three default plans (free / pro / business), and sets up Row Level Security.
3. **Copy environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` from Project Settings → API in Supabase.
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Run locally**:
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000`.

## Making yourself a Super Admin
After signing up normally through `/auth/signup`, promote your own account by
running this in the Supabase SQL editor:
```sql
update public.users set role = 'admin' where email = 'you@example.com';
```
You'll then be redirected to `/admin` on your next login.

## Dark mode
Handled via CSS variables (`--ringo-bg`, `--ringo-surface`, `--ringo-text`,
`--ringo-muted`, `--ringo-border` in `globals.css`) plus a `.dark` class on
`<html>`. On first load, `layout.tsx` runs an inline script that checks
`localStorage` then the OS `prefers-color-scheme` and applies `.dark`
before paint (no flash). The `ThemeToggle` component (in the dashboard and
admin headers) lets a user override that manually, saved to `localStorage`.
Brand accents (`ringo-indigo`, `ringo-coral`, `ringo-teal`) stay fixed in
both modes — only backgrounds, text, and borders adapt. The public profile
page doesn't have a toggle yet; it just follows the visitor's OS setting.

## Auth pages
Four production-grade pages under `src/app/auth/`:
- **`/auth/login`** — email/password, inline error banner, "forgot password" link, suspended-account handling
- **`/auth/signup`** — live username availability check (debounced), password strength meter, terms checkbox
- **`/auth/forgot-password`** — sends a Supabase reset email; always shows success (never reveals whether an email has an account)
- **`/auth/reset-password`** — the page the reset email links to; listens for Supabase's `PASSWORD_RECOVERY` auth event before showing the form, so it doesn't flash an "invalid link" error while the session loads

All four share `AuthShell` (split-screen layout with an animated "signal rings" brand panel — the visual signature, representing the "ring" in Ringo Connect) plus reusable `FormField`, `SubmitButton`, and `FormBanner` components in `src/components/auth/`.

Typography uses two Google Fonts loaded via `next/font/google` (Space Grotesk for headings, Inter for body/forms) — these need normal internet access to fetch at build time; they're cached after the first build.

## What's scaffolded vs. what's next
**Included:**
- Full database schema + RLS policies (`supabase/schema.sql`)
- Auth (signup/login), creator editor (links, socials, catalog, WhatsApp, pixels),
  plan-based feature gating, click-event tracking, analytics dashboard
- Admin dashboard: user list, plan changes, suspend/reactivate, audit log

**Not yet built — natural next steps:**
- Image upload UI wired to Supabase Storage (buckets aren't created yet)
- Drag-to-reorder for links/products (currently uses `sort_order` but no UI drag handle)
- Facebook/TikTok Pixel script injection on the public profile page (`<head>` tags)
- Stripe billing sync (admin currently assigns plans manually — by design, per spec)
- Admin "impersonate creator" flow and content moderation queue
- Public-page theme color actually applied to the UI (the field exists, isn't wired to styles yet)

## Deploying
Push this to GitHub, import into Vercel, add the same environment variables
there, and deploy. Once live on a real domain, the Facebook/TikTok pixels
(once wired in) will start reporting real events.
