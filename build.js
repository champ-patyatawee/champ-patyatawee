#!/usr/bin/env node

/**
 * build.js — Static blog generator for champ-patyatawee.com
 *
 * Reads Markdown files from blog/posts/, parses frontmatter,
 * converts to HTML using `marked`, and generates:
 *   - blog/index.html       (listing page with card grid)
 *   - blog/<slug>.html      (individual post page)
 *
 * Usage: node build.js
 *
 * Dependencies: marked, gray-matter
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const matter = require('gray-matter');

// ============================================================
// Configuration
// ============================================================
const POSTS_DIR = path.join(__dirname, 'blog', 'posts');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const OUTPUT_DIR = path.join(__dirname, 'blog');
const SITE_URL = 'https://champ-patyatawee.com';

// Configure marked for safety
marked.setOptions({
    breaks: false,
    gfm: true,
});

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
 * Slugify a filename (strip .md extension)
 */
function slugify(filename) {
    return path.basename(filename, '.md');
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
 * Generate a post card HTML for the listing page
 */
function generatePostCard(post) {
    return `
            <div class="post-card">
                <h2 class="post-card-title"><a href="${post.slug}.html">${escapeHtml(post.title)}</a></h2>
                <div class="post-card-date"><i data-lucide="calendar" style="width:14px;height:14px;stroke-width:2;"></i> ${post.dateFormatted}</div>
                <p class="post-card-excerpt">${post.excerpt}</p>
                <div class="post-card-tags">${post.tagsHtml}</div>
                <div class="post-card-footer">
                    <a href="${post.slug}.html" class="read-more">Read more <i data-lucide="arrow-right" style="width:14px;height:14px;stroke-width:2.5;"></i></a>
                </div>
            </div>`;
}

// ============================================================
// Main Build
// ============================================================

function build() {
    console.log('🚀 Building blog...\n');

    // 1. Read all .md files from posts directory
    let files;
    try {
        files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
    } catch (err) {
        console.error(`❌ Could not read posts directory: ${POSTS_DIR}`);
        console.error(`   Make sure the directory exists and contains .md files.`);
        process.exit(1);
    }

    if (files.length === 0) {
        console.log('⚠️  No Markdown files found in blog/posts/. Nothing to build.');
        return;
    }

    console.log(`📄 Found ${files.length} post(s): ${files.join(', ')}\n`);

    // 2. Parse each file
    const posts = files.map((file) => {
        const filePath = path.join(POSTS_DIR, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        const { data, content } = parsed;
        const slug = slugify(file);

        // Convert markdown to HTML
        const htmlContent = marked.parse(content);

        // Generate excerpt from frontmatter or content
        const excerpt =
            data.excerpt || generateExcerpt(htmlContent);

        const tags = Array.isArray(data.tags) ? data.tags : [];
        const dateFormatted = formatDate(data.date);
        const readingTime = calculateReadingTime(content);
        const tagsHtml = generateTags(tags);

        return {
            slug,
            title: data.title || slug,
            date: data.date ? new Date(data.date) : new Date(0),
            dateFormatted,
            tags,
            tagsHtml,
            readingTime,
            excerpt,
            htmlContent,
        };
    });

    // 3. Sort by date descending (newest first)
    posts.sort((a, b) => b.date - a.date);

    console.log(`📝 Posts sorted by date (newest first):`);
    posts.forEach((p) => console.log(`   - ${p.dateFormatted}: ${p.title}`));
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

        // Replace all placeholders
        page = page.replace(/\{\{title\}\}/g, escapeHtml(post.title));
        page = page.replace(/\{\{date\}\}/g, post.dateFormatted);
        page = page.replace(/\{\{content\}\}/g, post.htmlContent);
        page = page.replace(/\{\{excerpt\}\}/g, post.excerpt);
        page = page.replace(/\{\{tags\}\}/g, post.tagsHtml);
        page = page.replace(/\{\{slug\}\}/g, post.slug);
        page = page.replace(/\{\{readingTime\}\}/g, String(post.readingTime));

        // Replace encoded title for share URLs
        const encodedTitle = encodeURIComponent(post.title);
        page = page.replace(/\{\{encodedTitle\}\}/g, encodedTitle);

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
