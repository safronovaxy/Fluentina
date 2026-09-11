import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { strapiClient } from '@/lib/strapi';
import BlogPostPage from '@/page-components/BlogPostPage';
import { generateArticleSchema } from '@/lib/seo';

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    const posts = await strapiClient.getBlogPosts();
    return posts.data.map((post) => ({ slug: post.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const data = await strapiClient.getBlogPost(slug);
    const post = data.data[0];
    if (!post) return { title: 'Post Not Found | Fluentina Blog' };

    const imageUrl =
      post.featuredImage?.url ||
      'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=600&fit=crop';

    const imageWidth = post.featuredImage?.width ?? 1200;
    const imageHeight = post.featuredImage?.height ?? 630;
    const imageAlt = post.featuredImage?.alternativeText ?? post.title;

    // Normalise publishedDate to a valid ISO-8601 string for article:published_time
    const publishedTime = post.publishedDate
      ? new Date(post.publishedDate).toISOString()
      : undefined;

    return {
      title: `${post.title} | Fluentina Blog`,
      description: post.seoDescription || post.excerpt,
      alternates: { canonical: `https://fluentina.com/blog/${slug}` },
      openGraph: {
        title: `${post.title} | Fluentina Blog`,
        description: post.seoDescription || post.excerpt,
        url: `https://fluentina.com/blog/${slug}`,
        type: 'article',
        publishedTime,
        authors: [post.author],
        section: post.category,
        tags: [post.category, 'German learning', 'language learning', 'Fluentina'],
        images: [
          {
            url: imageUrl,
            width: imageWidth,
            height: imageHeight,
            alt: imageAlt,
          },
        ],
      },
    };
  } catch {
    return { title: 'Post Not Found | Fluentina Blog' };
  }
}

export default async function BlogPostRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [postResult, allPostsResult] = await Promise.allSettled([
    strapiClient.getBlogPost(slug),
    strapiClient.getBlogPosts(),
  ]);

  const postData = postResult.status === 'fulfilled' ? postResult.value : null;
  const allPostsData = allPostsResult.status === 'fulfilled' ? allPostsResult.value : null;

  if (!postData || postData.data.length === 0) {
    notFound();
  }

  const post = postData.data[0];
  const relatedPosts = (allPostsData?.data ?? [])
    .filter((p) => p.slug !== slug && p.category === post.category)
    .slice(0, 2)
    .map((p) => ({ slug: p.slug, title: p.title, category: p.category }));

  const articleSchema = generateArticleSchema({
    title: post.title,
    description: post.seoDescription || post.excerpt,
    url: `https://fluentina.com/blog/${post.slug}`,
    datePublished: new Date(post.publishedDate).toISOString(),
    dateModified: post.updatedAt,
    author: post.author,
    image: post.featuredImage?.url,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <BlogPostPage post={post} relatedPosts={relatedPosts} />
    </>
  );
}
