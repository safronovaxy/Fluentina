/**
 * Sitemap generator — runs at build time before `vite build`.
 *
 * Fetches all published blog posts and video resources from Strapi,
 * then writes a complete sitemap.xml to public/sitemap.xml.
 *
 * Required env var (set in GitHub Actions secrets):
 *   VITE_STRAPI_URL — base URL of the CMS, e.g. https://writewise-cms-xxx.run.app
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STRAPI_URL =
  process.env.VITE_STRAPI_URL ||
  'https://writewise-cms-m2xkjyh6ta-oe.a.run.app';
const SITE_URL = 'https://fluentina.com';
const today = new Date().toISOString().split('T')[0];

const staticPages = [
  { loc: '/',               changefreq: 'weekly',  priority: '1.0' },
  { loc: '/pricing',        changefreq: 'monthly', priority: '0.9' },
  { loc: '/about',          changefreq: 'monthly', priority: '0.7' },
  { loc: '/for-freelancers',changefreq: 'monthly', priority: '0.7' },
  { loc: '/blog',           changefreq: 'daily',   priority: '0.8' },
  { loc: '/resources',      changefreq: 'weekly',  priority: '0.7' },
  { loc: '/placement-test',         changefreq: 'monthly', priority: '0.7' },
  { loc: '/placement-test/german',  changefreq: 'monthly', priority: '0.9' },
  { loc: '/placement-test/english', changefreq: 'monthly', priority: '0.9' },
  { loc: '/contact',        changefreq: 'monthly', priority: '0.5' },
  { loc: '/privacy',        changefreq: 'yearly',  priority: '0.3' },
  { loc: '/terms',          changefreq: 'yearly',  priority: '0.3' },
];

async function fetchFromStrapi(path) {
  try {
    const url = `${STRAPI_URL}${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  Warning: ${url} returned ${res.status}`);
      return [];
    }
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.warn(`  Warning: could not reach Strapi — ${err.message}`);
    return [];
  }
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

async function generateSitemap() {
  console.log('Generating sitemap.xml…');
  console.log(`  CMS: ${STRAPI_URL}`);

  const [blogPosts, videoResources] = await Promise.all([
    fetchFromStrapi(
      '/api/blog-posts?fields[0]=slug&fields[1]=publishedAt&pagination[pageSize]=200&sort=publishedAt:desc'
    ),
    fetchFromStrapi(
      '/api/resources?filters[category][$eq]=Videos&fields[0]=slug&fields[1]=publishedAt&pagination[pageSize]=200'
    ),
  ]);

  const entries = [
    // Static pages
    ...staticPages.map(({ loc, changefreq, priority }) =>
      urlEntry(`${SITE_URL}${loc}`, today, changefreq, priority)
    ),

    // Blog posts
    ...blogPosts.map((post) => {
      const lastmod = post.publishedAt
        ? post.publishedAt.split('T')[0]
        : today;
      return urlEntry(
        `${SITE_URL}/blog/${post.slug}`,
        lastmod,
        'monthly',
        '0.6'
      );
    }),

    // Video resources
    ...videoResources.map((video) => {
      const lastmod = video.publishedAt
        ? video.publishedAt.split('T')[0]
        : today;
      return urlEntry(
        `${SITE_URL}/resources/videos/${video.slug}`,
        lastmod,
        'monthly',
        '0.5'
      );
    }),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
  ].join('\n');

  const outputPath = resolve(__dirname, '../public/sitemap.xml');
  writeFileSync(outputPath, xml, 'utf-8');

  console.log(
    `  Done — ${staticPages.length} static pages, ` +
    `${blogPosts.length} blog posts, ` +
    `${videoResources.length} video resources.`
  );
  console.log(`  Written to: ${outputPath}`);
}

generateSitemap();
