import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { strapiClient } from '@/lib/strapi';
import VideoResourcePage from '@/page-components/VideoResourcePage';

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    const resources = await strapiClient.getResources();
    return resources.data
      .filter((r) => r.category === 'Videos')
      .map((r) => ({ slug: r.slug }));
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
    const data = await strapiClient.getResource(slug);
    const resource = data.data[0];
    if (!resource) return { title: 'Video Not Found | Fluentina Resources' };

    return {
      title: `${resource.title} | Fluentina Resources`,
      description: resource.description,
      alternates: { canonical: `https://fluentina.com/resources/videos/${slug}` },
      openGraph: {
        title: `${resource.title} | Fluentina Resources`,
        description: resource.description,
        url: `https://fluentina.com/resources/videos/${slug}`,
        type: 'website',
      },
    };
  } catch {
    return { title: 'Video Not Found | Fluentina Resources' };
  }
}

export default async function VideoResourceRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [videoResult, allResourcesResult] = await Promise.allSettled([
    strapiClient.getResource(slug),
    strapiClient.getResources(),
  ]);

  const videoData = videoResult.status === 'fulfilled' ? videoResult.value : null;
  const allResourcesData =
    allResourcesResult.status === 'fulfilled' ? allResourcesResult.value : null;

  if (!videoData || videoData.data.length === 0) {
    notFound();
  }

  const video = videoData.data[0];
  const relatedVideos = (allResourcesData?.data ?? [])
    .filter((r) => r.category === 'Videos' && r.slug !== slug)
    .slice(0, 3)
    .map((r) => ({ slug: r.slug, title: r.title, duration: r.duration || '' }));

  return <VideoResourcePage video={video} relatedVideos={relatedVideos} />;
}
