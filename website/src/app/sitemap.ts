import type { MetadataRoute } from 'next';
import { strapiClient } from '@/lib/strapi';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://fluentina.com';

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    // /pricing is deliberately absent for the proof-of-concept phase: it is
    // unlinked from nav (ADR-8) and also kept out of search, so a prospect
    // cannot land on the paid-tier page directly from Google during the
    // free-conversion validation window. The route and its Stripe plumbing
    // stay in place and reachable — see the page's own robots metadata.
    { url: `${base}/blog`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/resources`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/contact`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/for-freelancers`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/placement-test`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/placement-test/german`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/placement-test/english`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
  ];

  // Dynamic blog posts (with hero images for Google Image Search indexing)
  let blogRoutes: MetadataRoute.Sitemap = [];
  try {
    const posts = await strapiClient.getBlogPosts();
    blogRoutes = posts.data.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
      ...(post.featuredImage?.url ? { images: [post.featuredImage.url] } : {}),
    }));
  } catch { /* CMS unreachable at build time is OK */ }

  // Dynamic video resources
  let videoRoutes: MetadataRoute.Sitemap = [];
  try {
    const resources = await strapiClient.getResources();
    videoRoutes = resources.data
      .filter((r) => r.category === 'Videos')
      .map((r) => ({
        url: `${base}/resources/videos/${r.slug}`,
        lastModified: new Date(r.updatedAt),
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      }));
  } catch { /* OK */ }

  return [...staticRoutes, ...blogRoutes, ...videoRoutes];
}
