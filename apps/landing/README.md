# @implenix/landing

Marketing landing site for **implenix.net** — Implenix, a US medical billing
agency for practitioners. Astro v5, fully static output, no client framework
(the booking widget is a plain TypeScript island).

## Pages

- `/` — hero, trust band, services, how-it-works, who-we-serve, FAQ (with
  `FAQPage` + `ProfessionalService` JSON-LD), final CTA
- `/book` — custom Google Calendar booking widget (talks to the Render API)
- `/privacy-policy`, `/terms-of-service`, `/hipaa-notice` — legal pages

## Setup

From the **repo root** (npm workspaces):

```bash
npm install
npm run dev -w apps/landing        # http://localhost:4321
npm run build -w apps/landing      # output in apps/landing/dist
npm run typecheck -w apps/landing  # astro check
```

## Environment

Copy `.env.example` to `.env`:

| Variable         | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `PUBLIC_API_URL` | Booking API base URL (Render), e.g. `https://api.implenix.net`. The widget calls `${PUBLIC_API_URL}/api/booking/...`. No trailing slash. |

The value is inlined at build time into the `/book` page, so redeploy after
changing it.

## Deploy (Netlify)

This app lives in a monorepo, so in the Netlify site settings:

1. **Base directory:** `apps/landing` (this makes Netlify pick up
   `apps/landing/netlify.toml`).
2. The build command in `netlify.toml` cds to the repo root, installs all
   workspaces, and builds only this app:
   `cd ../.. && npm install && npm run build -w apps/landing`.
3. **Publish directory:** `dist` (relative to the base directory — already set
   in `netlify.toml`).
4. Set the `PUBLIC_API_URL` environment variable in Site settings →
   Environment variables.

### DNS

Point **implenix.net** at Netlify:

- Either delegate the domain's nameservers to Netlify DNS (simplest), or
- Add an `A`/`ALIAS`/`ANAME` record for the apex `implenix.net` to Netlify's
  load balancer per the Netlify custom-domain instructions, plus a `CNAME`
  for `www.implenix.net` to the site's `*.netlify.app` hostname. Netlify
  provisions HTTPS automatically once DNS resolves.

`https://implenix.net` is set as `site` in `astro.config.mjs`, which drives
canonical URLs and the generated sitemap (`/sitemap-index.xml`, referenced by
`public/robots.txt`).

## Notes

- **Logo:** `src/components/Logo.astro` is a placeholder wordmark. When the
  client's logo arrives, replace the contents of that one component (and
  `public/favicon.svg`).
- **OG image:** `public/og-image.svg` is a placeholder; some social scrapers
  prefer PNG — swap in a 1200x630 PNG (and update `Layout.astro`) when brand
  assets arrive.
- **Booking API contract** is defined in `packages/shared/src/index.ts`
  (`BookingSlot`, `BookingRequest`, `BookingResponse`) and documented in the
  frontmatter of `src/components/BookingWidget.astro`.
