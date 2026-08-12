---
name: build-and-deploy
description: Build, verify, and publish the champ.patyatawee.com static portfolio site — build.js pipeline, generated outputs, template/design conventions, and Cloudflare Pages deployment.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

## What I do

- Documents the static-site build pipeline (`build.js` + `npm run build:blog`): inputs, outputs, and order of operations.
- Explains the hand-rolled template system (`templates/`), the design system (`design.json`), and where each CSS/theme file applies.
- Covers how the site is deployed (Cloudflare Pages + `_redirects`), what gets committed, and the conventions to follow so builds never break.

## When to use me

- The user asks to build, rebuild, regenerate, deploy, or publish the site.
- The user asks how the build works, where files are output, what the templates do, or why the site looks the way it does.
- The user asks to change the site's look, navigation, footer, or page templates.

## Usage

### 1. Build command (verbatim)

From the repo root:

```bash
npm install          # first time only — installs gray-matter + marked
npm run build:blog   # == node build.js — regenerates all blog pages
```

There is no dev server, no bundler, and no test script (`npm test` is a stub that exits 1 — don't use it as a verification step).

### 2. What the build does (order of operations)

`build.js` (plain Node, `#!/usr/bin/env node`):

1. Reads every subdirectory of `blog/posts/`; the folder name is the slug. Skips folders with neither `en.md` nor `th.md`.
2. Parses frontmatter with `gray-matter` and converts body to HTML with `marked` (GFM on, `breaks: false`). A custom renderer turns ` ```mermaid ` fences into `<pre class="mermaid">` for client-side rendering.
3. Computes per-post: reading time (~200 wpm, min 1), excerpt (frontmatter or auto ~200 chars), formatted date, tag badges, language availability (`has_both`).
4. Sorts posts by `date` descending (newest first).
5. Fills placeholders in `templates/blog-post.html` (per post) and `templates/blog-listing.html` (cards for all posts).
6. Writes outputs (see below).

### 3. Inputs → outputs

| Input | Output |
|---|---|
| `blog/posts/<slug>/{en,th}.md` | `blog/<slug>.html` (post page with EN/TH tabs) |
| all posts | `blog/index.html` (listing, card grid) |
| `templates/blog-post.html` | every post page shell |
| `templates/blog-listing.html` | listing page shell |
| `image/blog/<slug>/*` | referenced by content (`../image/blog/...`) and OG images (`https://champ.patyatawee.com/image/blog/<image>`) |

Generated `blog/*.html` files are **committed to git** (not in `.gitignore`) — they are the deployable artifacts. `.gitignore` only excludes `.DS_Store` and `node_modules/`.

### 4. Site structure & conventions

- **`index.html`** — homepage (About / Services / Customers sections, contact modal, Lucide icons, scroll animations). Inline `<style>` with the design-system CSS custom properties.
- **`resume.html`** — standalone resume page with its own independent stylesheet block (DM Sans, light). Nav links to `../resume.html`.
- **`blog/style.css`** — blog pages' stylesheet (linked as `style.css?v=2`); same CSS custom properties as `index.html`.
- **`profile_theme.css`** — a dark shadcn-style theme file, **not** part of the live design; treat as a reference/leftover, do not link it into pages.
- **`design.json`** — the source of truth "Startup Marketing Design System". Live pages implement its tokens as CSS custom properties:

  - Background `#F7F7F4` (grid-pattern paper), surface `#FFFFFF`, text `#111111`, muted `#555555`
  - Primary `#1E50FF`, secondary `#F5A9D6`, accent `#D9FF2A`, cyan `#3BE8F6`, yellow `#FFD84D`
  - 2px solid `#111111` borders; hard offset shadows `4px 4px 0 0 #111111`; radius card 20 / button 16 / tag 8
  - Fonts: Poppins (headings), Inter (body), JetBrains Mono (code) — Google Fonts via `@import`
  - Icons: Lucide from CDN (`lucide.createIcons()` after DOM ready)

- **CDN runtime deps** (no local assets): Prism 1.29.0 (code highlighting + autoloader), mermaid@11 (diagrams), lucide (icons).

### 5. Deployment (Cloudflare Pages)

- Git remote: `git@github.com:champ-patyatawee/champ-patyatawee.git`, branch `main`. No CI workflows exist — deployment is Cloudflare Pages' git integration on the repo.
- Site: `champ-patyatawee.pages.dev`, canonical domain `https://champ.patyatawee.com`.
- `_redirects` (Cloudflare Pages file) enforces the canonical domain with 301s:
  ```
  https://champ-patyatawee.pages.dev/* https://champ.patyatawee.com/:splat 301
  https://champ.patyatawee.com/* https://champ.patyatawee.com/:splat 301
  ```
- To publish: commit the new/regenerated files (including `blog/*.html` outputs) and push to `main`. The build happens before deploy via `npm run build:blog`.

## Format / Templates

- **`templates/blog-post.html`** placeholders: `{{slug}}`, `{{date}}`, `{{has_both}}`, `{{en_title}}`, `{{en_content}}`, `{{en_tags}}`, `{{en_readingTime}}`, `{{en_excerpt}}`, `{{en_dateFormatted}}`, `{{th_title}}`, `{{th_content}}`, `{{th_tags}}`, `{{th_readingTime}}`, `{{th_excerpt}}`, `{{th_dateFormatted}}`, plus JSON-encoded `{{en_title_json}}`, `{{en_date_json}}`, `{{en_readingTime_json}}`, `{{en_tags_json}}` (and `th_*` variants) for the client-side `langData` switcher, plus `{{encodedTitle}}`, `{{page_url}}` (`https://champ.patyatawee.com/blog/<slug>`), `{{og_image}}`.
- **`templates/blog-listing.html`**: single `{{posts}}` placeholder replaced with one `.post-card` per post (title link, EN/TH badge, date, excerpt, tags, "Read more").
- If you add a placeholder to a template, `build.js` must replace it — an unreplaced `{{...}}` renders verbatim on the page. Keep templates and `build.js` in sync.

## Workflow

1. Edit content (`blog/posts/`) and/or templates.
2. Run `npm run build:blog` from the repo root.
3. Check the script output for `❌`/`⚠️` errors; confirm `✅ Generated:` lines for each post and `blog/index.html`.
4. Spot-check `blog/index.html` + one post page in a browser (mermaid, Prism highlighting, lucide icons, language tabs).
5. Commit everything — markdown sources, images, AND regenerated `blog/*.html` — then push to `main`; Cloudflare Pages deploys the canonical domain.

## Common pitfalls

- **Hand-editing generated `blog/*.html`** — always edit markdown/templates and rebuild; generated files get overwritten.
- **Forgetting to commit generated HTML** — the live site serves `blog/*.html` directly; markdown alone does not publish.
- **Unreplaced template placeholders** — adding `{{foo}}` to a template without adding a `page.replace(...)` in `build.js` leaks raw `{{foo}}` into the page.
- **Breaking `build.js`** — it's plain CommonJS Node; no watch mode, no config file. `SITE_URL` (`https://champ.patyatawee.com`) is a constant used for OG/canonical/hreflang URLs.
- **Changing nav/footer/socials** — these are duplicated across `index.html`, `resume.html`, and both blog templates; update all four or navigation will be inconsistent across pages.
- **`_redirects`** — keep the canonical-domain 301s intact; Cloudflare Pages fails the deploy if this file has syntax errors.
