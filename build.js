#!/usr/bin/env node

/**
 * build.js — Static blog generator for champ.patyatawee.com
 *
 * Reads bilingual Markdown files from blog/posts/<slug>/{en,th}.md and
 * feed/posts/<slug>/{en,th}.md, parses frontmatter, converts to HTML using
 * `marked`, and generates:
 *   - blog/index.html         (listing page with card grid)
 *   - blog/<slug>.html        (individual post page with EN/TH tabs)
 *   - feed/index.html         (Facebook-style timeline feed)
 *   - feed/<slug>.html        (individual feed post page with EN/TH tabs)
 *
 * Usage: node build.js
 *
 * Dependencies: marked, gray-matter
 */

const fs = require('fs');
const path = require('path');
const { marked, Renderer } = require('marked');
const matter = require('gray-matter');

// ============================================================
// Configuration
// ============================================================
const POSTS_DIR = path.join(__dirname, 'blog', 'posts');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const OUTPUT_DIR = path.join(__dirname, 'blog');
const SITE_URL = 'https://champ.patyatawee.com';

// Homepage — index.html gets the newest blog posts injected between markers
const HOME_INDEX = path.join(__dirname, 'index.html');
const HOME_POSTS_START = '<!-- HOME_POSTS_START -->';
const HOME_POSTS_END = '<!-- HOME_POSTS_END -->';
const HOME_LATEST_COUNT = 3;

// Feed section — mirrors the blog structure but renders as a social-style timeline
const FEED_POSTS_DIR = path.join(__dirname, 'feed', 'posts');
const FEED_OUTPUT_DIR = path.join(__dirname, 'feed');

// Configure marked for safety
marked.setOptions({
    breaks: false,
    gfm: true,
});

// Render Mermaid code blocks as <pre class="mermaid"> so the
// Mermaid runtime can render them into SVG diagrams in the browser.
// Other languages keep the default Prism-friendly output.
const renderer = new Renderer();
const defaultCodeRenderer = renderer.code.bind(renderer);
renderer.code = function (args) {
    const { text, lang } = args;
    const langName = (lang || '').trim().split(/\s+/)[0];
    if (langName === 'mermaid') {
        return `<pre class="mermaid">\n${text}\n</pre>\n`;
    }
    return defaultCodeRenderer(args);
};
marked.use({ renderer });

// ============================================================
// Helpers
// ============================================================

/**
 * Format a date string (e.g. "2025-07-15") to "July 15, 2025"
 */
function formatDate(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

/**
 * Calculate reading time in minutes (~200 words/min)
 */
function calculateReadingTime(text) {
    const words = text.trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200));
}

/**
 * Generate tag HTML badges from an array of tag strings
 */
function generateTags(tags) {
    if (!tags || !Array.isArray(tags) || tags.length === 0) return '';
    return tags
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join('\n');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Truncate HTML content to ~150 characters for excerpt
 */
function generateExcerpt(htmlContent, maxLength = 200) {
    // Strip HTML tags
    const text = htmlContent.replace(/<[^>]*>/g, '');
    // Decode HTML entities for accurate length
    const decoded = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");

    if (decoded.length <= maxLength) return escapeHtml(decoded.trim());

    // Find a word boundary near maxLength
    const truncated = decoded.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    const result = lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
    return escapeHtml(result.trim()) + '…';
}

/**
 * Parse a post folder for en.md and th.md into a combined post object.
 * Shared by the blog and feed builds.
 */
function parsePostDir(baseDir, slug) {
    const folderPath = path.join(baseDir, slug);
    const enData = parseLangFile(path.join(folderPath, 'en.md'), 'en');
    const thData = parseLangFile(path.join(folderPath, 'th.md'), 'th');

    if (!enData && !thData) return null;

    // Use English date as primary, fallback to Thai date
    const primaryDate = enData ? enData.date : thData.date;
    const dateFormatted = enData ? enData.dateFormatted : thData.dateFormatted;

    return {
        slug,
        date: primaryDate,
        dateFormatted,
        hasBothLangs: !!(enData && thData),

        en_title: enData ? enData.title : null,
        en_excerpt: enData ? enData.excerpt : null,
        en_content: enData ? enData.htmlContent : null,
        en_tags: enData ? enData.tags : [],
        en_tagsHtml: enData ? enData.tagsHtml : '',
        en_readingTime: enData ? enData.readingTime : 0,
        en_dateFormatted: enData ? enData.dateFormatted : '',

        th_title: thData ? thData.title : null,
        th_excerpt: thData ? thData.excerpt : null,
        th_content: thData ? thData.htmlContent : null,
        th_tags: thData ? thData.tags : [],
        th_tagsHtml: thData ? thData.tagsHtml : '',
        th_readingTime: thData ? thData.readingTime : 0,
        th_dateFormatted: thData ? thData.dateFormatted : '',
        image: (enData && enData.image) || (thData && thData.image) || '',
    };
}

/**
 * Parse a single markdown file from a post directory
 */
function parseLangFile(filePath, lang) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        const { data, content } = parsed;

        // Ensure lang frontmatter is set
        data.lang = data.lang || lang;

        const htmlContent = marked.parse(content);
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const readingTime = calculateReadingTime(content);
        const excerpt = data.excerpt || generateExcerpt(htmlContent);
        const dateFormatted = formatDate(data.date);

        return {
            title: data.title || slug,
            excerpt,
            htmlContent,
            tags,
            tagsHtml: generateTags(tags),
            readingTime,
            dateFormatted,
            date: data.date ? new Date(data.date) : new Date(0),
            lang: data.lang,
            image: data.image || '',
        };
    } catch (err) {
        console.error(`   ⚠️  Could not parse ${filePath}: ${err.message}`);
        return null;
    }
}

/**
 * Fill a post-page template (blog-post.html / feed-post.html) with a post's data.
 * Shared by the blog and feed builds — `pageUrl` and `ogImage` are absolute URLs.
 */
function fillPostTemplate(template, post, pageUrl, ogImage) {
    let page = template;

    // Replace placeholder values (escape where needed)
    page = page.replace(/\{\{slug\}\}/g, post.slug);
    page = page.replace(/\{\{date\}\}/g, post.dateFormatted);
    page = page.replace(/\{\{has_both\}\}/g, String(post.hasBothLangs));
    page = page.replace(/\{\{has_en\}\}/g, String(!!post.en_content));
    page = page.replace(/\{\{has_th\}\}/g, String(!!post.th_content));

    // English placeholders
    page = page.replace(/\{\{en_title\}\}/g, escapeHtml(post.en_title || post.th_title || post.slug));
    page = page.replace(/\{\{en_content\}\}/g, post.en_content || post.th_content || '');
    page = page.replace(/\{\{en_tags\}\}/g, post.en_tagsHtml || '');
    page = page.replace(/\{\{en_readingTime\}\}/g, String(post.en_readingTime || 0));
    page = page.replace(/\{\{en_excerpt\}\}/g, post.en_excerpt || post.th_excerpt || '');
    page = page.replace(/\{\{en_dateFormatted\}\}/g, post.en_dateFormatted || post.dateFormatted);

    // Thai placeholders
    page = page.replace(/\{\{th_title\}\}/g, escapeHtml(post.th_title || post.en_title || post.slug));
    page = page.replace(/\{\{th_content\}\}/g, post.th_content || post.en_content || '');
    page = page.replace(/\{\{th_tags\}\}/g, post.th_tagsHtml || '');
    page = page.replace(/\{\{th_readingTime\}\}/g, String(post.th_readingTime || 0));
    page = page.replace(/\{\{th_excerpt\}\}/g, post.th_excerpt || post.en_excerpt || '');
    page = page.replace(/\{\{th_dateFormatted\}\}/g, post.th_dateFormatted || post.dateFormatted);

    // JSON-encoded values for the langData JavaScript object
    // These use JSON.stringify() so they're safe for embedding in JS (handles quotes, newlines, etc.)
    const enTagsJson = JSON.stringify(post.en_tagsHtml || '');
    const thTagsJson = JSON.stringify(post.th_tagsHtml || '');
    const enTitleJson = JSON.stringify(post.en_title || post.th_title || post.slug);
    const thTitleJson = JSON.stringify(post.th_title || post.en_title || post.slug);
    const enDateJson = JSON.stringify(post.en_dateFormatted || post.dateFormatted);
    const thDateJson = JSON.stringify(post.th_dateFormatted || post.dateFormatted);
    const enReadingTimeJson = JSON.stringify((post.en_readingTime || 0) + ' min read');
    const thReadingTimeJson = JSON.stringify((post.th_readingTime || 0) + ' นาที');

    page = page.replace(/\{\{en_title_json\}\}/g, enTitleJson);
    page = page.replace(/\{\{en_date_json\}\}/g, enDateJson);
    page = page.replace(/\{\{en_readingTime_json\}\}/g, enReadingTimeJson);
    page = page.replace(/\{\{en_tags_json\}\}/g, enTagsJson);
    page = page.replace(/\{\{th_title_json\}\}/g, thTitleJson);
    page = page.replace(/\{\{th_date_json\}\}/g, thDateJson);
    page = page.replace(/\{\{th_readingTime_json\}\}/g, thReadingTimeJson);
    page = page.replace(/\{\{th_tags_json\}\}/g, thTagsJson);

    // Encoded title for share URLs
    const encodedTitle = encodeURIComponent(post.en_title || post.th_title || post.slug);
    page = page.replace(/\{\{encodedTitle\}\}/g, encodedTitle);

    // Canonical / hreflang / share URLs
    page = page.replace(/\{\{page_url\}\}/g, pageUrl);

    // Open Graph share image (absolute URL)
    page = page.replace(/\{\{og_image\}\}/g, ogImage);

    return page;
}

/**
 * Generate a feed card HTML — Facebook-style timeline card for feed/index.html
 */
function generateFeedCard(post) {
    // Determine display title: prefer English, fallback to Thai
    const displayTitle = post.en_title || post.th_title || post.slug;
    const displayExcerpt = post.en_excerpt || post.th_excerpt || '';

    // Build language badge
    let langBadge = '';
    if (post.hasBothLangs) {
        langBadge = `<span class="feed-lang-badge feed-lang-badge-both">EN / TH</span>`;
    } else if (post.en_title) {
        langBadge = `<span class="feed-lang-badge">EN</span>`;
    } else if (post.th_title) {
        langBadge = `<span class="feed-lang-badge">TH</span>`;
    }

    // Optional post image (relative path from the feed/ folder)
    const imageHtml = post.image
        ? `\n                <a href="${post.slug}.html" class="feed-card-image-wrap"><img src="../image/feed/${post.image}" alt="${escapeHtml(displayTitle)}" class="feed-card-image" loading="lazy"></a>`
        : '';

    const displayDate = post.en_dateFormatted || post.th_dateFormatted || post.dateFormatted;

    return `
            <article class="feed-card">
                <div class="feed-card-header">
                    <img src="../image/avatar/i.png" alt="Champ Patyatawee" class="feed-avatar">
                    <div class="feed-card-author">
                        <span class="feed-author-name">Champ Patyatawee</span>
                        <span class="feed-card-date">${displayDate}</span>
                    </div>
                    ${langBadge}
                </div>
                <h2 class="feed-card-title"><a href="${post.slug}.html">${escapeHtml(displayTitle)}</a></h2>
                <p class="feed-card-excerpt">${displayExcerpt}</p>${imageHtml}
                <div class="feed-card-tags">${post.en_tagsHtml || post.th_tagsHtml || ''}</div>
                <div class="feed-card-actions">
                    <a href="${post.slug}.html" class="feed-action" title="Read post"><i data-lucide="heart" style="width:18px;height:18px;stroke-width:2;"></i> Like</a>
                    <a href="${post.slug}.html" class="feed-action" title="Read post"><i data-lucide="message-circle" style="width:18px;height:18px;stroke-width:2;"></i> Comment</a>
                    <a href="${post.slug}.html" class="feed-action" title="Read post"><i data-lucide="share-2" style="width:18px;height:18px;stroke-width:2;"></i> Share</a>
                </div>
            </article>`;
}

/**
 * Generate a post card HTML for the listing page
 */
function generatePostCard(post) {
    // Determine display title: prefer English, fallback to Thai
    const displayTitle = post.en_title || post.th_title || post.slug;
    const displayExcerpt = post.en_excerpt || post.th_excerpt || '';

    // Build language badge
    let langBadge = '';
    if (post.hasBothLangs) {
        langBadge = `<span class="lang-badge lang-badge-both">EN / TH</span>`;
    } else if (post.en_title) {
        langBadge = `<span class="lang-badge">EN</span>`;
    } else if (post.th_title) {
        langBadge = `<span class="lang-badge">TH</span>`;
    }

    return `
            <div class="post-card">
                <div class="post-card-title-row">
                    <h2 class="post-card-title"><a href="${post.slug}.html">${escapeHtml(displayTitle)}</a></h2>
                    ${langBadge}
                </div>
                <div class="post-card-date"><i data-lucide="calendar" style="width:14px;height:14px;stroke-width:2;"></i> ${post.dateFormatted}</div>
                <p class="post-card-excerpt">${displayExcerpt}</p>
                <div class="post-card-tags">${post.en_tagsHtml || post.th_tagsHtml || ''}</div>
                <div class="post-card-footer">
                    <a href="${post.slug}.html" class="read-more">Read more <i data-lucide="arrow-right" style="width:14px;height:14px;stroke-width:2.5;"></i></a>
                </div>
            </div>`;
}

/**
 * Generate a compact post card for the homepage "Latest Articles" section.
 * Links are relative from the repo root (blog/<slug>.html).
 *
 * Both languages are embedded as data-* attributes so the homepage
 * language toggle can swap title/excerpt without a reload. The visible
 * text defaults to English.
 */
function generateHomePostCard(post) {
    const displayTitle = post.en_title || post.th_title || post.slug;
    const displayExcerpt = post.en_excerpt || post.th_excerpt || '';
    const thTitle = post.th_title || post.en_title || post.slug;
    const thExcerpt = post.th_excerpt || post.en_excerpt || '';

    let langBadge = '';
    if (post.hasBothLangs) {
        langBadge = `<span class="lang-badge lang-badge-both">EN / TH</span>`;
    } else if (post.en_title) {
        langBadge = `<span class="lang-badge">EN</span>`;
    } else if (post.th_title) {
        langBadge = `<span class="lang-badge">TH</span>`;
    }

    return `
                <div class="home-post-card" data-en-title="${escapeHtml(displayTitle)}" data-th-title="${escapeHtml(thTitle)}">
                    <h2 class="home-post-card-title"><a href="blog/${post.slug}.html">${escapeHtml(displayTitle)}</a>${langBadge}</h2>
                    <div class="home-post-card-date"><i data-lucide="calendar" style="width:14px;height:14px;stroke-width:2;"></i> ${post.dateFormatted}</div>
                    <p class="home-post-card-excerpt" data-en-excerpt="${escapeHtml(displayExcerpt)}" data-th-excerpt="${escapeHtml(thExcerpt)}">${displayExcerpt}</p>
                    <div class="home-post-card-tags">${post.en_tagsHtml || post.th_tagsHtml || ''}</div>
                    <div class="home-post-card-footer">
                        <a href="blog/${post.slug}.html" class="read-more" data-i18n="read_more">Read more <i data-lucide="arrow-right" style="width:14px;height:14px;stroke-width:2.5;"></i></a>
                    </div>
                </div>`;
}

/**
 * Inject the newest blog posts into the homepage index.html between the
 * HOME_POSTS markers. Idempotent — the markers are re-emitted, so repeated
 * builds update the section without touching the rest of the file.
 */
function updateHomepageLatest(posts) {
    let html;
    try {
        html = fs.readFileSync(HOME_INDEX, 'utf-8');
    } catch (err) {
        console.error(`❌ Could not read homepage: ${HOME_INDEX}`);
        return;
    }

    if (!html.includes(HOME_POSTS_START) || !html.includes(HOME_POSTS_END)) {
        console.warn(`   ⚠️  HOME_POSTS markers missing in index.html — skipping homepage latest-articles update.`);
        return;
    }

    const latest = posts.slice(0, HOME_LATEST_COUNT);
    const cards = latest.map((post) => generateHomePostCard(post)).join('\n');
    const injected = `\n${cards}\n`;

    const markerPattern = new RegExp(
        `${escapeRegExp(HOME_POSTS_START)}[\\s\\S]*?${escapeRegExp(HOME_POSTS_END)}`
    );

    const updated = html.replace(markerPattern, `${HOME_POSTS_START}${injected}${HOME_POSTS_END}`);

    if (updated === html) {
        console.log(`   ℹ️  Homepage latest articles unchanged (${latest.length} post(s)).`);
        return;
    }

    fs.writeFileSync(HOME_INDEX, updated, 'utf-8');
    console.log(`✅ Homepage latest articles updated (${latest.length} post(s))`);
}

/**
 * Escape a string for safe use inside a RegExp constructor.
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Feed Build
// ============================================================

/**
 * Build the feed section (feed/index.html + feed/<slug>.html).
 * Mirrors the blog build but renders posts as a social-style timeline
 * and uses image/feed/ for post images.
 */
function buildFeed() {
    console.log('\n📰 Building feed...');

    let entries;
    try {
        entries = fs.readdirSync(FEED_POSTS_DIR, { withFileTypes: true });
    } catch (err) {
        console.log('   ⚠️  Could not read feed/posts — skipping feed. Create feed/posts/<slug>/{en,th}.md to enable it.');
        return;
    }

    const postDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    if (postDirs.length === 0) {
        console.log('   ⚠️  No post directories found in feed/posts/. Skipping feed.');
        return;
    }

    console.log(`   📁 Found ${postDirs.length} feed post folder(s): ${postDirs.join(', ')}`);

    // Parse each folder for en.md and th.md
    const posts = postDirs.map((slug) => {
        const post = parsePostDir(FEED_POSTS_DIR, slug);
        if (!post) {
            console.error(`   ❌ Neither en.md nor th.md found in feed/posts/${slug}/ — skipping`);
            return null;
        }
        console.log(`   ✓ ${slug}: ${post.hasBothLangs ? 'EN + TH' : post.en_title ? 'EN only' : 'TH only'}`);
        return post;
    }).filter(Boolean);

    if (posts.length === 0) {
        console.log('   ⚠️  No valid feed posts found. Skipping feed.');
        return;
    }

    // Sort by date descending (newest first)
    posts.sort((a, b) => b.date - a.date);

    console.log('   📝 Feed posts sorted by date (newest first):');
    posts.forEach((p) => {
        const title = p.en_title || p.th_title || p.slug;
        console.log(`      - ${p.dateFormatted}: ${title} [${p.hasBothLangs ? 'EN/TH' : p.en_title ? 'EN' : 'TH'}]`);
    });

    // Load templates
    let feedPostTemplate, feedTemplate;
    try {
        feedPostTemplate = fs.readFileSync(
            path.join(TEMPLATES_DIR, 'feed-post.html'),
            'utf-8'
        );
    } catch (err) {
        console.error(`❌ Could not read template: templates/feed-post.html`);
        process.exit(1);
    }

    try {
        feedTemplate = fs.readFileSync(
            path.join(TEMPLATES_DIR, 'feed.html'),
            'utf-8'
        );
    } catch (err) {
        console.error(`❌ Could not read template: templates/feed.html`);
        process.exit(1);
    }

    // Generate individual feed post pages
    posts.forEach((post) => {
        const pageUrl = `${SITE_URL}/feed/${post.slug}`;
        const ogImage = post.image
            ? `${SITE_URL}/image/feed/${post.image}`
            : `${SITE_URL}/image/avatar/i.png`;

        const page = fillPostTemplate(feedPostTemplate, post, pageUrl, ogImage);
        const outputPath = path.join(FEED_OUTPUT_DIR, `${post.slug}.html`);
        fs.writeFileSync(outputPath, page, 'utf-8');
        console.log(`✅ Generated: feed/${post.slug}.html`);
    });

    // Generate feed timeline page (Facebook-style cards)
    const feedCards = posts.map((post) => generateFeedCard(post)).join('\n');
    let feedPage = feedTemplate;
    feedPage = feedPage.replace(/\{\{posts\}\}/g, feedCards);
    feedPage = feedPage.replace(/\{\{post_count\}\}/g, String(posts.length));

    const feedOutputPath = path.join(FEED_OUTPUT_DIR, 'index.html');
    fs.writeFileSync(feedOutputPath, feedPage, 'utf-8');
    console.log(`✅ Generated: feed/index.html (${posts.length} post(s))`);
}

// ============================================================
// Main Build
// ============================================================

function build() {
    console.log('🚀 Building bilingual blog...\n');

    // 1. Read all subdirectories from posts directory
    let entries;
    try {
        entries = fs.readdirSync(POSTS_DIR, { withFileTypes: true });
    } catch (err) {
        console.error(`❌ Could not read posts directory: ${POSTS_DIR}`);
        console.error(`   Make sure the directory exists and contains post subdirectories.`);
        process.exit(1);
    }

    const postDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    if (postDirs.length === 0) {
        console.log('⚠️  No post directories found in blog/posts/. Nothing to build.');
        return;
    }

    console.log(`📁 Found ${postDirs.length} post folder(s): ${postDirs.join(', ')}\n`);

    // 2. Parse each folder for en.md and th.md
    const posts = postDirs.map((slug) => {
        const post = parsePostDir(POSTS_DIR, slug);
        if (!post) {
            console.error(`   ❌ Neither en.md nor th.md found in ${slug}/ — skipping`);
            return null;
        }
        console.log(`   ✓ ${slug}: ${post.hasBothLangs ? 'EN + TH' : post.en_title ? 'EN only' : 'TH only'}`);
        return post;
    }).filter(Boolean);

    if (posts.length === 0) {
        console.log('⚠️  No valid posts found. Nothing to build.');
        return;
    }

    // 3. Sort by date descending (newest first)
    posts.sort((a, b) => b.date - a.date);

    console.log(`\n📝 Posts sorted by date (newest first):`);
    posts.forEach((p) => {
        const title = p.en_title || p.th_title || p.slug;
        console.log(`   - ${p.dateFormatted}: ${title} [${p.hasBothLangs ? 'EN/TH' : p.en_title ? 'EN' : 'TH'}]`);
    });
    console.log('');

    // 4. Load templates
    let postTemplate, listingTemplate;
    try {
        postTemplate = fs.readFileSync(
            path.join(TEMPLATES_DIR, 'blog-post.html'),
            'utf-8'
        );
    } catch (err) {
        console.error(`❌ Could not read template: templates/blog-post.html`);
        process.exit(1);
    }

    try {
        listingTemplate = fs.readFileSync(
            path.join(TEMPLATES_DIR, 'blog-listing.html'),
            'utf-8'
        );
    } catch (err) {
        console.error(`❌ Could not read template: templates/blog-listing.html`);
        process.exit(1);
    }

    // 5. Generate individual post pages
    posts.forEach((post) => {
        const pageUrl = `${SITE_URL}/blog/${post.slug}`;
        const ogImage = post.image
            ? `${SITE_URL}/image/blog/${post.image}`
            : `${SITE_URL}/image/avatar/i.png`;

        const page = fillPostTemplate(postTemplate, post, pageUrl, ogImage);
        const outputPath = path.join(OUTPUT_DIR, `${post.slug}.html`);
        fs.writeFileSync(outputPath, page, 'utf-8');
        console.log(`✅ Generated: blog/${post.slug}.html`);
    });

    // 6. Generate listing page
    const postCards = posts.map((post) => generatePostCard(post)).join('\n');
    let listingPage = listingTemplate;
    listingPage = listingPage.replace(/\{\{posts\}\}/g, postCards);

    const listingOutputPath = path.join(OUTPUT_DIR, 'index.html');
    fs.writeFileSync(listingOutputPath, listingPage, 'utf-8');
    console.log(`✅ Generated: blog/index.html (${posts.length} post(s))`);

    // 6b. Inject newest blog posts into the homepage "Latest Articles" section
    updateHomepageLatest(posts);

    // 7. Build feed section
    buildFeed();

    console.log('\n🎉 Blog build complete!');
}

build();
