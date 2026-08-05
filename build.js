#!/usr/bin/env node

/**
 * build.js — Static blog generator for champ.patyatawee.com
 *
 * Reads bilingual Markdown files from blog/posts/<slug>/{en,th}.md,
 * parses frontmatter, converts to HTML using `marked`, and generates:
 *   - blog/index.html         (listing page with card grid)
 *   - blog/<slug>.html        (individual post page with EN/TH tabs)
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
        const folderPath = path.join(POSTS_DIR, slug);
        const enPath = path.join(folderPath, 'en.md');
        const thPath = path.join(folderPath, 'th.md');

        const enData = parseLangFile(enPath, 'en');
        const thData = parseLangFile(thPath, 'th');

        if (!enData && !thData) {
            console.error(`   ❌ Neither en.md nor th.md found in ${slug}/ — skipping`);
            return null;
        }

        // Use English date as primary, fallback to Thai date
        const primaryDate = enData ? enData.date : thData.date;
        const dateFormatted = enData ? enData.dateFormatted : thData.dateFormatted;

        const post = {
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
        console.log(`   ✓ ${slug}: ${post.hasBothLangs ? 'EN + TH' : enData ? 'EN only' : 'TH only'}`);
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
        let page = postTemplate;

        // Replace placeholder values (escape where needed)
        page = page.replace(/\{\{slug\}\}/g, post.slug);
        page = page.replace(/\{\{date\}\}/g, post.dateFormatted);
        page = page.replace(/\{\{has_both\}\}/g, String(post.hasBothLangs));

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

        // hreflang URLs
        page = page.replace(/\{\{page_url\}\}/g, `${SITE_URL}/blog/${post.slug}`);

        // Open Graph share image (absolute URL). Falls back to the site avatar.
        const ogImage = post.image
            ? `${SITE_URL}/image/blog/${post.image}`
            : `${SITE_URL}/image/avatar/i.png`;
        page = page.replace(/\{\{og_image\}\}/g, ogImage);

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

    console.log('\n🎉 Blog build complete!');
}

build();
