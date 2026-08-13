---
name: site-design-system
description: Apply and extend the champ.patyatawee.com "Startup Marketing" design system — grid-paper background, 2px black borders, hard offset shadows, Poppins/Inter/JetBrains Mono, brand palette — with exact tokens from design.json and component recipes for the main site and blog.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

## What I do

- Documents the canonical design system for this site (`design.json`, "Startup Marketing Design System" v1.0.0): a **light-mode, brutalist-flavored** look — near-white grid-paper background (`#F7F7F4`), **2px solid `#111111` borders everywhere**, **hard offset shadows with zero blur** (`4px 4px 0 0 #111111`), chunky rounded cards (20px), Poppins headings / Inter body / JetBrains Mono code, and a playful brand palette (blue `#1E50FF`, pink `#F5A9D6`, lime `#D9FF2A`, cyan `#3BE8F6`, yellow `#FFD84D`).
- Explains the **two implementation layers** that mirror `design.json`: the main site's inline `<style>` in `index.html` and `blog/style.css` for blog pages — both expose the same `:root` custom properties, and both must stay in sync with `design.json`.
- Provides copy-paste **component recipes** (buttons, cards, nav pill, tags, modal, mobile menu, hero, footer, blog cards) with the real class names and CSS values used in the codebase.
- Covers **Lucide icons** (CDN, `data-lucide` attributes, `lucide.createIcons()`) and the Memphis-style illustration/decorations conventions.

Complements `how-to-write-blog-posts` (content format) and `build-and-deploy` (build pipeline + deployment). Use this skill for anything that changes how a page *looks*; use the others for content and shipping.

## When to use me

- The user asks to style, restyle, or add a new section/component/page to the site (homepage, blog, modals, cards, buttons, nav).
- The user asks how the site's look is defined, why things are 2px-bordered and flat-shadowed, or what colors/fonts to use.
- The user asks to change a design token (color, radius, font, shadow) and needs to know every file that must be updated.
- The user is creating a new HTML page and wants it to look like the rest of the site.

## Usage

### 1. Design language in one paragraph

Light mode only. Near-white background (`--bg: #F7F7F4`) with a subtle **40px grid pattern** (two `linear-gradient` lines at `rgba(0,0,0,0.04)`, 1px, `background-size: 40px 40px`). Everything you can touch gets a **2px solid `#111111` border** and a **hard offset shadow** — no blur, no spread, pure `offsetX offsetY 0 0 #111111`. Interactive elements *move* on hover (`translate(-2px,-2px)` while the shadow doubles to `8px 8px`) and press down on active (`translate(2px,2px)`, shadow collapses to `2px 2px`). Radii: cards 20px, buttons 16px, tags 8px, nav pill 24px. Headings are bold Poppins; body is Inter; code is JetBrains Mono. Accent colors are used sparingly — the lime `#D9FF2A` is THE call-to-action color (primary buttons, "Hire me").

### 2. The two implementation layers (and the sync rule)

There is exactly **one source of truth** — `design.json` — and **two CSS implementations** of it:

| Layer | File | How it consumes tokens |
|---|---|---|
| Main site | `index.html` | Inline `<style>` block; `:root { --bg: #F7F7F4; ... }` custom properties |
| Blog | `blog/style.css` | Linked as `style.css?v=2`; the **identical** `:root` block plus blog-only components (`.post-card`, `.tag`, `.lang-tab`, Prism overrides) |

- **Changing a token means updating all three**: `design.json` + the `:root` block in `index.html` + the `:root` block in `blog/style.css`. Miss one and pages drift apart.
- `resume.html` is **intentionally separate** — it uses its own minimal DM Sans / DM Serif Display print-focused theme. Do not restyle it to match the main system.
- `profile_theme.css` is a **dark shadcn-style theme that is NOT part of the live design** (a reference/leftover). Never link it into a page.
- The nav + footer are duplicated across `index.html`, `resume.html`, the two blog templates, and the two feed templates (`templates/feed.html`, `templates/feed-post.html`) — any nav/footer change must be mirrored in all six. Note: the feed pages link to the blog and homepage; blog pages do not link to the feed (by design).
- When you edit `blog/style.css`, **bump the cache-busting query** on the `<link>` in the blog templates (`style.css?v=3`), otherwise visitors keep the old stylesheet.

### 3. How to consume tokens in CSS

Always use the custom properties — never hardcode colors except where the codebase already does (`box-shadow` values hardcode `#111111`; shadow color is the same as `--border` so this is fine and consistent):

```css
.my-component {
    background-color: var(--surface);
    border: 2px solid var(--border);        /* 2px #111111 — the house style */
    border-radius: var(--radius-card);      /* 20px for cards, 16px buttons, 8px tags */
    box-shadow: var(--shadow-card);         /* 4px 4px 0 0 #111111 — no blur */
    padding: 32px;                          /* spacing scale: 4px base (spacing.8) */
}
```

Fonts load via `@import` from Google Fonts (Poppins 400–800, Inter 400–600, JetBrains Mono 400–500) at the top of both stylesheets.

## Design tokens

Verbatim from `design.json` (v1.0.0). The CSS `:root` blocks in `index.html` and `blog/style.css` mirror the same values.

### theme

| Token | Value |
|---|---|
| mode | `light` |
| background | `#F7F7F4` |
| surface | `#FFFFFF` |
| text | `#111111` |
| textSecondary | `#555555` |
| border | `#111111` |

### colors

| Token | Value |
|---|---|
| primary | `#1E50FF` |
| secondary | `#F5A9D6` |
| accent | `#D9FF2A` |
| cyan | `#3BE8F6` |
| yellow | `#FFD84D` |
| black | `#111111` |
| white | `#FFFFFF` |
| gray50 | `#F7F7F4` |
| gray100 | `#ECECEC` |
| gray200 | `#DDDDDD` |
| gray300 | `#C8C8C8` |
| gray500 | `#777777` |
| gray700 | `#444444` |
| gray900 | `#111111` |
| success | `#00D084` |
| warning | `#FFC93C` |
| danger | `#FF4D4F` |

### typography

| Token | Value |
|---|---|
| fontFamily.heading | `Poppins` |
| fontFamily.body | `Inter` |
| fontFamily.mono | `JetBrains Mono` |
| fontWeight | regular `400`, medium `500`, semibold `600`, bold `700`, black `800` |
| fontSize.xs / sm / base / lg / xl / 2xl / 3xl / 4xl / 5xl | `12` / `14` / `16` / `18` / `24` / `36` / `48` / `64` / `80` |
| lineHeight.tight / normal / relaxed | `1.1` / `1.5` / `1.8` |
| letterSpacing.tight / normal / wide | `-2%` / `0%` / `2%` |

### spacing

Scale in px (4px base): `0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48, 16:64, 20:80, 24:96, 32:128`

### radius

| Token | Value |
|---|---|
| none | `0` |
| sm | `8` |
| md | `12` |
| lg | `20` |
| xl | `28` |
| full | `9999` |

### border

| Token | Value |
|---|---|
| width.thin / default / heavy | `1` / `2` / `3` |
| color | `#111111` |

### shadow

| Token | Value |
|---|---|
| shadow.card | `x:4, y:4, blur:0, spread:0, color:#111111` |
| shadow.button | `x:3, y:3, blur:0, spread:0, color:#111111` |

### layout

| Token | Value |
|---|---|
| container.maxWidth | `1280` |
| container.padding | `32` |
| grid.columns / gutter / margin | `12` / `32` / `32` |

### buttons

| Variant | background | text | border | radius | padding |
|---|---|---|---|---|---|
| primary | `#D9FF2A` | `#111111` | `2px solid #111111` | `16` | x `28` / y `16` |
| secondary | `#FFFFFF` | `#111111` | `2px solid #111111` | `16` | x `28` / y `16` |
| ghost | `transparent` | `#111111` | none | – | – |

primary uses shadow `button` (`3px 3px 0 0 #111111` in JSON; the CSS `.btn` class actually ships `4px 4px 0 0` — keep whatever the current CSS uses).

### cards

| Variant | background | text | radius | border | shadow | padding |
|---|---|---|---|---|---|---|
| default | `#FFFFFF` | – | `20` | `2px solid #111111` | card | `32` |
| blue | `#1E50FF` | `#FFFFFF` | – | – | – | – |
| pink | `#F5A9D6` | `#111111` | – | – | – | – |

### navigation

| Token | Value |
|---|---|
| height | `72` |
| background | `#FFFFFF` |
| border | `2px solid #111111` |
| radius | `24` |

### hero

| Token | Value |
|---|---|
| title.fontSize / fontWeight / lineHeight | `80` / `700` / `1.05` |
| description.fontSize / lineHeight / color | `18` / `1.6` / `#555555` |
| buttonSpacing | `32` |

### icons

| Token | Value |
|---|---|
| stroke | `2` |
| color | `#111111` |
| style | `outline` |

### illustration (Memphis)

| Token | Value |
|---|---|
| style | `Memphis` |
| outline | `#111111` |
| outlineWidth | `2` |
| palette | `["#1E50FF", "#F5A9D6", "#FFD84D", "#D9FF2A", "#3BE8F6", "#FFFFFF", "#111111"]` |

### decorations

`gridPattern: true`, `geometricShapes: true`, `outlined: true`, `playful: true` — the grid background, outlined Memphis shapes, and playful geometry are brand elements, not optional extras.

### motion

| Token | Value |
|---|---|
| duration.fast / normal / slow | `150` / `250` / `400` (ms) |
| easing.default | `ease-out` |
| easing.bounce | `cubic-bezier(.34,1.56,.64,1)` |

### CSS custom property mapping (the `:root` mirror — identical in index.html and blog/style.css)

```css
:root {
    --bg: #F7F7F4;          --surface: #FFFFFF;
    --text: #111111;        --text-muted: #555555;
    --primary: #1E50FF;     --secondary: #F5A9D6;
    --accent: #D9FF2A;      --cyan: #3BE8F6;
    --yellow: #FFD84D;      --black: #111111;
    --white: #FFFFFF;       --border: #111111;
    --success: #00D084;     --warning: #FFC93C;
    --danger: #FF4D4F;
    --shadow-card: 4px 4px 0 0 #111111;
    --shadow-btn: 3px 3px 0 0 #111111;
    --radius-card: 20px;    --radius-btn: 16px;
    --radius-tag: 8px;      --radius-full: 9999px;
}
```

## Component recipes

Real classes and values from the codebase. All components assume the shared `:root` block and the grid-pattern `body` background:

```css
body {
    background-color: var(--bg);
    background-image:
        linear-gradient(rgba(0, 0, 0, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 0, 0, 0.04) 1px, transparent 1px);
    background-size: 40px 40px;
    color: var(--text);
    font-family: 'Inter', sans-serif;
    line-height: 1.6;
}
h1, h2, h3, h4, h5, h6 { font-family: 'Poppins', sans-serif; font-weight: 700; line-height: 1.2; color: var(--text); }
```

### Button variants

Base `.btn` (all variants share this):

```css
.btn {
    padding: 12px 28px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 600;
    border: 2px solid var(--border);
    border-radius: var(--radius-btn);        /* 16px */
    background: transparent;
    color: var(--text);
    box-shadow: 4px 4px 0 0 #111111;
    display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
    text-decoration: none; cursor: pointer;
    transition: all 0.2s ease;
}
.btn:hover  { transform: translate(-2px, -2px); box-shadow: 8px 8px 0 0 #111111; }
.btn:active { transform: translate(2px, 2px);  box-shadow: 2px 2px 0 0 #111111; }
```

| Variant | Class | Delta from `.btn` | Use for |
|---|---|---|---|
| Primary | `.btn-primary` | `background-color: var(--accent)` (lime) | main CTAs ("Explore Services", "Hire Me") |
| Secondary | `.btn-secondary` | `background: var(--white)` | alternate CTAs ("Download Resume") |
| Nav "Hire me" | `.btn-hire-me` | `padding: 10px 24px; font-size: 13px; background-color: var(--accent)` | the nav-pill CTA |
| Ghost | (inline style) | `background: transparent; border: none` | quiet actions |

### Card variants

Card shells all use the same recipe: `background-color: var(--surface); border: 2px solid var(--border); border-radius: var(--radius-card); box-shadow: var(--shadow-card);` then hover `transform: translate(-2px,-2px); box-shadow: 8px 8px 0 0 #111111;`.

| Class | Where | Padding | Notes |
|---|---|---|---|
| `.service-category` | homepage services grid | `32px` | header row has `border-bottom: 2px solid var(--primary)`; list items shift `translateX(8px)` + turn primary on hover |
| `.post-card` | blog listing grid | `2rem` | flex column; `.post-card-title` Poppins 1.4rem/700; `.post-card-excerpt` `var(--text-muted)`; hover as above |
| `.logo-item` | customers logo grid | – | `aspect-ratio: 1/1`; hover `translate(-3px,-3px)`; `.logo-info` slides up, `border-top: 2px solid var(--primary)` |
| `.blog-post` | blog article body | `3rem` | wraps `.post-content` |
| Colored cards | CTA section | – | `.cta-section` uses `background-color: var(--primary)` with white heading and a lime `.btn-primary`; pink `#F5A9D6` (secondary) is the lighter accent surface |

### Navigation pill

```css
nav {
    display: flex; align-items: center;
    padding: 0 2rem;
    height: 72px;                              /* navigation.height */
    border: 2px solid var(--border);
    border-radius: 24px;                       /* navigation.radius */
    background-color: var(--white);
    box-shadow: 4px 4px 0 0 #111111;
    max-width: 1280px; margin: 0 auto; margin-top: 16px;
    position: sticky; top: 16px; z-index: 1000;
    gap: 2rem;
}
```

- `.logo` — Poppins 22px / weight 800 / `letter-spacing: 2px`.
- `.nav-links a` — 13px, weight 500, `text-transform: uppercase`, `letter-spacing: 1.5px`; hover/active color `var(--primary)` with a 2px underline (`::after`, width 0 → 100%).
- Mobile (≤768px): `.nav-links` and `.nav-buttons` hide; `.mobile-menu-btn` (2px border, `--radius-tag`, 22px icon) appears.

### Tags / chips

```css
.tag {
    display: inline-block;
    padding: 4px 12px;
    font-size: 0.75rem; font-weight: 600; font-family: 'Inter', sans-serif;
    color: var(--primary);
    background-color: #EEF0FF;                 /* light blue tint — in-palette companion */
    border: 2px solid var(--border);
    border-radius: var(--radius-tag);          /* 8px */
    text-transform: uppercase; letter-spacing: 0.5px;
    transition: all 0.2s ease;
}
.tag:hover { background-color: var(--primary); color: var(--white); transform: translateY(-1px); }
```

Related chips: `.lang-badge` (EN/TH on listing cards — 2px solid `var(--primary)`, radius 6px, uppercase 0.7rem/700; `.lang-badge-both` fills primary bg) and `.lang-tab` (blog language switcher — 2px border, radius 8px, active = primary bg + white text).

### Contact modal

```css
.modal-overlay {
    position: fixed; inset: 0;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex; justify-content: center; align-items: center;
    z-index: 2000;
    opacity: 0; visibility: hidden; transition: all 0.3s ease;
}
.modal-overlay.active { opacity: 1; visibility: visible; }

.modal {
    background-color: var(--surface);
    border-radius: var(--radius-card);
    border: 2px solid var(--border);
    box-shadow: 8px 8px 0 0 #111111;           /* heavier than card — sits above the page */
    width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto;
    padding: 2.5rem; position: relative;
    transform: translateY(-20px) scale(0.97);  /* entrance animation */
    transition: transform 0.3s ease;
}
.modal-overlay.active .modal { transform: translateY(0) scale(1); }
```

- `.modal-close` — 36×36px, 2px border, `--radius-tag`, `X` icon; hover fills `var(--primary)` with white icon.
- `.contact-icon` — 44×44px, `border: 2px solid var(--primary)`, `--radius-tag`, primary icon inside.
- `.social-link` — 44×44px, 2px border, `--radius-tag`; hover: primary bg, white icon, `translateY(-3px)`, `3px 3px 0 0 #111111` shadow.
- `.modal-title` — Poppins 2rem/700; `.modal-subtitle` / labels: `var(--text-muted)`, uppercase, letter-spaced.

### Mobile menu (≤768px)

```css
.mobile-menu {
    display: none;
    position: absolute; top: 100%; left: 0; right: 0;
    background-color: var(--white);
    flex-direction: column; padding: 1rem;
    border: 2px solid var(--border); border-top: none;
    border-radius: 0 0 var(--radius-card) var(--radius-card);
    box-shadow: 4px 4px 0 0 #111111;
    z-index: 100;
}
.mobile-menu.active { display: flex; }
.mobile-menu a { padding: 0.85rem 0; font-size: 14px; font-weight: 500;
                 text-transform: uppercase; letter-spacing: 1px;
                 border-bottom: 1px solid var(--border); }
#hire-me-mobile-btn { width: 100%; padding: 0.85rem; border: 2px solid var(--border);
                      border-radius: var(--radius-btn); background-color: var(--accent);
                      box-shadow: 4px 4px 0 0 #111111; }
```

### Hero

`.main-content` (hero section): `padding: 5rem 2rem; min-height: 100vh; max-width: 1280px; margin: 0 auto;`. `.left-section` has the signature `border-left: 4px solid var(--primary)`. `h1` — Poppins 700, **80px**, `line-height: 1.05`, `letter-spacing: -0.02em` (56px @ ≤992px, 44px @ ≤768px, 36px @ ≤576px). `.hero-subtitle` — 18px, `var(--text-muted)`, `line-height: 1.6`, max-width 540px. `.hero-stats .stat-number` — Poppins 700 2.2rem in `var(--primary)`; `.stat-label` — 0.72rem uppercase letter-spaced muted. `.avatar-square` — 320×320px, `--radius-card`.

### Footer

Black panel (`background-color: var(--black)`), muted slate text (`#94a3b8`, bottom bar `#64748b`), column headings in `var(--accent)` uppercase Poppins 600 0.9rem. `.footer-content` max-width 1280px. Social icons: 16px inline SVGs colored `var(--accent)` (`.footer-social-icon`).

### Blog components (blog/style.css only)

- `.blog-listing` — max-width 1280px, `padding: 5rem 2rem`; `.blog-header` gets `border-bottom: 2px solid var(--border)`.
- `.post-grid` — `grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 2rem;` (1fr ≤768px).
- `.read-more` — Inter 600 0.9rem `var(--primary)`, gap animates 0.4rem → 0.7rem on hover.
- `.post-content` — 1.05rem / `line-height: 1.8`; `h2` Poppins 700 1.6rem with `border-bottom: 2px solid var(--primary)`; `blockquote` — 2px border + **4px primary left border**, bg `#F0F0ED`, italic muted; `pre` — JetBrains Mono 0.85rem, bg `#F0F0ED`, 2px border, radius 12px; inline `code` — radius 6px, 2px border; images — radius 12px, 2px border, `box-shadow: var(--shadow-card)`.
- **Prism overrides** (brand syntax colors): keywords/tags/numbers `#1E50FF`, strings/builtins `#00D084`, comments `#A8A8A8` italic, punctuation/operators `#111111`, functions bold text color.
- Mermaid blocks: `.post-content pre.mermaid` — white bg, 2px border, radius 12px, centered.

### Icons (Lucide)

```html
<script src="https://unpkg.com/lucide@latest"></script>
...
<i data-lucide="menu"></i>
<script>lucide.createIcons();</script>
```

- Icons are replaced in place with inline SVGs; **stroke 2**, color `#111111` (outline style) unless overridden.
- **Call `lucide.createIcons()` again after any DOM change that injects `data-lucide` elements** — e.g. the blog post page re-runs it when switching EN/TH language tabs.
- Sizing via CSS classes or inline styles; real patterns from the code:
  - `.service-icon` 28×28 `var(--primary)`; `.service-item-icon` 18×18, `stroke-width: 2.5`
  - `.meta-icon` 14×14; `.back-icon` 16×16 `stroke-width: 2.5`; `.footer-social-icon` 16×16
  - Inline sizing on listing: `<i data-lucide="calendar" style="width:14px;height:14px;stroke-width:2;"></i>` and `<i data-lucide="arrow-right" style="width:14px;height:14px;stroke-width:2.5;"></i>`
- Brand/social icons (GitHub, LinkedIn, YouTube, Facebook) are **hand-written inline SVGs** (`stroke="currentColor" stroke-width="2"`), not lucide — keep that pattern.

## Workflow

1. **Read `design.json` first** — it is the source of truth for every color, radius, shadow, and size.
2. **Reuse before you invent** — copy the closest existing component (`.btn`, `.service-category`, `.post-card`, `.modal`) from `index.html` / `blog/style.css` and adapt; do not write new look-alike styles from scratch.
3. Write new styles against the `:root` custom properties; only `box-shadow` values may hardcode `#111111` (matching the existing pattern).
4. If the component appears on both the homepage and blog, add it to **both** `index.html`'s `<style>` and `blog/style.css`, keeping the values identical.
5. Add icons as `<i data-lucide="name"></i>` and call `lucide.createIcons()` (again, after any dynamic DOM update).
6. Check the responsive breakpoints: 1200px (grid collapse), 992px (stacking), 768px (mobile menu appears), 576px (tight padding).
7. Verify the visual contract: grid-pattern background visible, every bordered element 2px, every shadow hard (no blur), radii from the scale (20/16/8), text contrast on `#F7F7F4` (muted `#555555` reads fine; white text only on primary/black).
8. If blog templates or `blog/style.css` changed, run `npm run build:blog` and bump the `style.css?v=` query (see `build-and-deploy` for the build; `how-to-write-blog-posts` for content).

## Common pitfalls

- **New fonts or colors outside the system** — only Poppins / Inter / JetBrains Mono and the documented palette. No new Google Fonts, no arbitrary hexes (exceptions in the codebase are the light-tint companions `#EEF0FF`, `#F0F0ED` and footer slate grays `#94a3b8`/`#64748b`).
- **Soft/blurred shadows** — shadows are hard offsets with zero blur: `4px 4px 0 0 #111111` (cards), `3px 3px 0 0` (buttons), `8px 8px 0 0` (modal/hover). No `box-shadow` with a blur radius, ever.
- **Mixing border-radius styles** — 20px cards/modal, 16px buttons, 8px tags/icon squares, 24px nav pill, 12px code blocks/images, 6px inline code/lang badges. Picking "a nice 10px" breaks the system.
- **Dropping the grid background** — the 40px grid pattern on `body` is a brand element (`decorations.gridPattern: true`); new pages must keep the `background-image` gradient pair.
- **Contrast on the off-white background** — `#111111` text on `#F7F7F4`, muted `#555555` for secondary; white text only on `--primary` blue and `--black`. Never put `#555555` or white-on-lime (lime is the button color with `#111111` text).
- **Updating only one of the three token sources** — `design.json`, `index.html :root`, `blog/style.css :root` must change together.
- **Forgetting `lucide.createIcons()` after DOM changes** — icons injected after initial load (e.g., blog language-tab switch) stay as empty `<i>` tags unless icons are re-created.
- **"Fixing" `resume.html` or linking `profile_theme.css`** — the resume's DM Sans theme is intentional (print-focused, separate); `profile_theme.css` is a dark leftover that is not part of the live design.
- **Duplicate nav/footer** — mirrored across `index.html`, `resume.html`, `templates/blog-post.html`, `templates/blog-listing.html`, `templates/feed.html`, `templates/feed-post.html`; update all six or pages disagree.
- **Stale `style.css?v=`** — blog visitors on Cloudflare Pages cache the stylesheet; bump the version query after editing `blog/style.css`.
