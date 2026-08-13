---
name: how-to-write-blog-posts
description: Add or edit bilingual (EN/TH) blog posts for the champ.patyatawee.com static site — exact frontmatter, markdown features, image handling, and build/verify steps.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

## What I do

- Explains the exact content format for blog posts in this repo: folder-per-post layout, YAML frontmatter fields, bilingual `en.md` / `th.md` variants, supported markdown features, and image conventions.
- Covers how to run the static build and verify the generated HTML.
- Content lives in `blog/posts/<slug>/`; generated pages land in `blog/`.

## When to use me

- The user asks to write, add, edit, translate, or fix a blog post / article on this site.
- The user asks how posts are structured, what frontmatter fields exist, or why a post doesn't show up on the blog listing.

## Usage

### 1. Create the post folder

Each post is a folder under `blog/posts/`. The **folder name is the URL slug** and the output filename:

```
blog/posts/<Slug-Name>/
├── en.md   # English version (required for an EN post)
└── th.md   # Thai version (optional; omit for English-only posts)
```

Example: `blog/posts/Keycloak-High-Availability/en.md` → generates `blog/Keycloak-High-Availability.html` served at `https://champ.patyatawee.com/blog/Keycloak-High-Availability`.

### 2. Frontmatter (exact fields)

```markdown
---
title: "Post Title Here"
date: 2026-08-03
tags: [kubernetes, gitops, keycloak]
excerpt: "Optional one-two sentence summary. If omitted, one is auto-generated (~200 chars) from the content."
image: My-Slug/og-image.jpg
lang: en
---
```

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Quoted string. Used for the page `<title>`, cards, and share metadata. |
| `date` | yes | `YYYY-MM-DD`. Posts are sorted **newest first**. Missing/invalid dates fall back to epoch (sorted last). |
| `tags` | yes | YAML array of lowercase kebab strings; rendered as `.tag` badges. |
| `excerpt` | no | Plain-text summary; auto-generated from content if absent (HTML stripped, truncated at a word boundary, `…` appended). |
| `image` | no | Path relative to `image/blog/`, including the post subfolder, e.g. `Keycloak-High-Availability/keycloak-icon-og.jpg`. Used as the Open Graph share image → absolute URL `https://champ.patyatawee.com/image/blog/<image>`. Falls back to the site avatar (`/image/avatar/i.png`). |
| `lang` | optional | `en` or `th`. Auto-set from the filename if missing (`data.lang = data.lang || lang`). |

### 3. Supported markdown (marked v18, GFM on, `breaks: false`)

- Standard GFM: headings, lists, bold/italic, links, tables, blockquotes.
- **Code blocks** are highlighted client-side by Prism (autoloader) — use fenced blocks with a language tag, e.g. ``` ```bash ``` ```, ``` ```yaml ```.
- **Mermaid diagrams** render in the browser. Use the `mermaid` fence:
  ````markdown
  ```mermaid
  flowchart TB
      A --> B
  ```
  ````
  The build converts these to `<pre class="mermaid">`; the template's mermaid@11 CDN script renders them on load and when switching language tabs.
- **Lucide icons** (via CDN): `<i data-lucide="calendar"></i>` — re-created automatically on tab switch.

### 4. Images

- **In-content images**: reference them with a relative path from the generated page (`blog/`), e.g.
  ```markdown
  ![Keycloak](../image/blog/Keycloak-High-Availability/keycloak-icon.jpg)
  ```
  Put the file in `image/blog/<slug>/`. (Do NOT use `/image/...` absolute paths in markdown content.)
- **OG/share image**: set `image:` in frontmatter (see table above) — this builds the absolute share URL. Recommended ~1200×630 JPEG.

### 5. Bilingual posts (optional)

- Add a `th.md` with the same frontmatter shape (`lang: th`) to publish a Thai version.
- The post page gets EN/TH tabs; a `EN / TH` badge shows on the listing card.
- If a post is English-only, the Thai tab is hidden automatically (`has_both` flag).
- Missing content falls back across languages (e.g. `en.md` only → Thai tab still shows English content but is hidden; `en_title` fallback chain is `en → th → slug`).

### 6. Build & verify

```bash
npm run build:blog    # == node build.js
```

Regenerates `blog/index.html` (listing with post cards) and `blog/<slug>.html` for **every** post. The build script:

1. Scans `blog/posts/` for subdirectories (skips folders with neither `en.md` nor `th.md`).
2. Parses frontmatter with gray-matter, converts markdown with marked.
3. Computes reading time (~200 words/min, min 1), excerpt, formatted date ("August 3, 2026"), tag badges.
4. Sorts posts by date descending.
5. Fills `templates/blog-post.html` and `templates/blog-listing.html` placeholders.
6. Writes `blog/<slug>.html` and `blog/index.html`.

Verify: open `blog/index.html` in a browser, confirm the new card appears, click through to the post, check tags, mermaid diagrams, and code highlighting.

## 7. Feed posts (`feed/posts/`) — Facebook-style timeline

The feed is a second, independent content area rendered as a social-style timeline. Content format is **identical to blog posts** — same frontmatter schema, same bilingual `en.md`/`th.md` layout — but lives in its own folder and image space:

```
feed/posts/<Slug>/
├── en.md   # English version (required for an EN post)
└── th.md   # Thai version (optional)
```

- Frontmatter fields are the same as the blog table in section 2 (`title`, `date`, `tags`, `excerpt`, `image`, `lang`).
- Feed images go in `image/feed/<slug>/`. The frontmatter `image:` path must include the post subfolder (e.g. `My-Slug/pic.jpg`) and becomes the card image + OG image (`https://champ.patyatawee.com/image/feed/My-Slug/pic.jpg`).
- In-content images use `../image/feed/<slug>/...` relative paths.
- The build generates `feed/index.html` (timeline of Facebook-style cards: avatar + author header, title, excerpt, card image, tags, EN/TH badge, Like/Comment/Share action bar) and `feed/<slug>.html` (full page with EN/TH tabs, mermaid, Prism — everything blog post pages have).
- Cards are sorted newest first; card titles fall back EN → TH → slug; the EN/TH badge appears when both languages exist.
- The `⚠️ Could not parse … th.md` lines in build output for English-only posts are harmless (the build still succeeds).
- Feed pages are committed to git like blog pages; rebuild after any markdown edit.

## Format / Templates

- Post pages use `templates/blog-post.html` — placeholders include `{{slug}}`, `{{date}}`, `{{en_title}}` / `{{th_title}}`, `{{en_content}}` / `{{th_content}}`, `{{en_tags}}` / `{{th_tags}}`, `{{en_readingTime}}` / `{{th_readingTime}}`, `{{en_excerpt}}`, `{{page_url}}`, `{{og_image}}`, `{{encodedTitle}}`, `{{has_both}}`, plus `*_json` variants used by the `langData` JS object. Do not edit generated HTML; edit markdown (or the template) and rebuild.
- Listing page uses `templates/blog-listing.html` with a single `{{posts}}` placeholder.

## Workflow

1. `mkdir blog/posts/<Slug-Name>` and create `en.md` (add `th.md` for bilingual).
2. Write frontmatter exactly as in the table; put the title in quotes.
3. Add images to `image/blog/<slug>/`; reference with `../image/blog/<slug>/file` in content and set `image:` for the share image.
4. Run `npm run build:blog` from the repo root.
5. Confirm no `❌`/`⚠️` parse errors in the output; the script prints `✅ Generated: blog/<slug>.html` per post.
6. Open `blog/index.html` and the new post page to verify rendering (mermaid, Prism, tags, date ordering).

## Common pitfalls

- **Forgetting to rebuild** — generated `blog/*.html` files are committed; edits to markdown alone won't change the live site.
- **Wrong image path in content** — paths are relative to `blog/`, so prefix with `../image/blog/...`.
- **Missing `image:` subfolder prefix** — frontmatter image paths must include the post folder, e.g. `My-Slug/pic.jpg`, not just `pic.jpg`.
- **Unquoted titles with colons/special chars** — quote `title:` to keep YAML valid.
- **Non-kebab or duplicate slugs** — folder name must be unique and URL-safe; it becomes both the filename and the URL.
- **`date` typos** — a bad date string formats as-is and sorts to the bottom (epoch fallback).
