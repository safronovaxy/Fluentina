'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SEO } from "@/components/SEO";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Play, FileText, Download, Clock, BookOpen, Video, HelpCircle, ArrowRight, ExternalLink, Wrench } from "lucide-react";
import { useResources, useFAQs } from "@/hooks/use-strapi";
import Link from "next/link";
import type { StrapiResponse, Resource, FAQ } from "@/types/strapi";

interface ResourcesProps {
  initialResourcesData?: StrapiResponse<Resource[]>;
  initialFaqData?: StrapiResponse<FAQ[]>;
}

// Helper function to extract YouTube video ID from various URL formats
const getYouTubeVideoId = (url: string): string | null => {
  if (!url) return null;

  // Handle youtu.be short URLs
  const shortUrlMatch = url.match(/youtu\.be\/([^?]+)/);
  if (shortUrlMatch) return shortUrlMatch[1];

  // Handle youtube.com/watch?v= URLs
  const longUrlMatch = url.match(/[?&]v=([^&]+)/);
  if (longUrlMatch) return longUrlMatch[1];

  // Handle youtube.com/embed/ URLs
  const embedMatch = url.match(/\/embed\/([^?]+)/);
  if (embedMatch) return embedMatch[1];

  return null;
};

// Helper function to get YouTube thumbnail URL
const getYouTubeThumbnail = (videoUrl: string | undefined): string => {
  if (!videoUrl) return 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=225&fit=crop';

  const videoId = getYouTubeVideoId(videoUrl);
  if (!videoId) return 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=225&fit=crop';

  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
};

const Resources = ({ initialResourcesData, initialFaqData }: ResourcesProps = {}) => {
  const { data: fetchedResourcesData, isLoading: resourcesLoading } = useResources();
  const { data: fetchedFaqData, isLoading: faqLoading } = useFAQs(); // Fetch all FAQs
  const resourcesData = fetchedResourcesData ?? initialResourcesData;
  const faqData = fetchedFaqData ?? initialFaqData;

  const allResources = resourcesData?.data || [];

  // Organize resources by category
  const videos = allResources.filter(r => r.category === 'Videos');
  const guides = allResources.filter(r => r.category === 'Guides');
  const tools = allResources.filter(r => r.category === 'Tools');
  const articles = allResources.filter(r => r.category === 'Articles');

  // Organize FAQs by category
  const allFAQs = faqData?.data || [];
  const faqsByCategory = {
    General: allFAQs.filter(f => f.category === 'General'),
    Pricing: allFAQs.filter(f => f.category === 'Pricing'),
    Technical: allFAQs.filter(f => f.category === 'Technical'),
    Account: allFAQs.filter(f => f.category === 'Account'),
  };

  // Check if FAQ has any content
  const hasFAQs = allFAQs.length > 0;

  // While loading, keep all tabs visible so the layout doesn't collapse to
  // "no content" during hydration. Filter to content-only tabs once data is ready.
  const allTabs = [
    { value: 'guides', label: 'Guides', icon: FileText, count: guides.length, hasContent: guides.length > 0 },
    { value: 'tools', label: 'Tools', icon: Wrench, count: tools.length, hasContent: tools.length > 0 },
    { value: 'articles', label: 'Articles', icon: BookOpen, count: articles.length, hasContent: articles.length > 0 },
    { value: 'videos', label: 'Videos', icon: Video, count: videos.length, hasContent: videos.length > 0 },
    { value: 'faq', label: 'FAQ', icon: HelpCircle, count: allFAQs.length, hasContent: hasFAQs },
  ];
  const availableTabs = (resourcesLoading || faqLoading) ? allTabs : allTabs.filter(tab => tab.hasContent);

  // Get first available tab for default value
  const defaultTab = availableTabs.length > 0 ? availableTabs[0].value : 'guides';

  return (
    <>
      <SEO
        title="Learning Resources - Fluentina"
        description="Video tutorials, guides, tools, and FAQs to help you get the most out of Fluentina. Everything you need to accelerate your language learning journey."
        keywords="language learning resources, Fluentina tutorials, language learning guides, writing practice tips, Fluentina FAQ"
      />
      {/* Hero */}
      <section className="bg-gradient-brand-subtle py-16">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="mb-4 text-4xl font-bold text-foreground md:text-5xl">
              Learning <span className="text-gradient-brand">Resources</span>
            </h1>
            <p className="text-lg text-muted-foreground">
              Video tutorials, guides, and FAQs to help you get the most out of Fluentina.
            </p>
          </div>
        </div>
      </section>

      {/* Tabs Content */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          {availableTabs.length === 0 ? (
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-lg text-muted-foreground">
                No resources available yet. Check back soon!
              </p>
            </div>
          ) : (
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className={`mb-8 grid w-full max-w-2xl mx-auto ${
                availableTabs.length === 1 ? 'grid-cols-1' :
                availableTabs.length === 2 ? 'grid-cols-2' :
                availableTabs.length === 3 ? 'grid-cols-3' :
                availableTabs.length === 4 ? 'grid-cols-4' :
                'grid-cols-5'
              }`}>
                {availableTabs.map(tab => (
                  <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-2">
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

            {/* Guides Tab */}
            <TabsContent value="guides">
              {resourcesLoading ? (
                <div className="grid gap-6 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="border-0">
                      <CardContent className="flex items-start gap-4 p-6">
                        <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
                        <div className="flex-1">
                          <Skeleton className="mb-2 h-6 w-3/4" />
                          <Skeleton className="mb-4 h-4 w-full" />
                          <div className="flex items-center justify-between">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-8 w-24" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {guides.map((guide) => (
                    <Card key={guide.title} className="card-elevated border-0">
                      <CardContent className="flex items-start gap-4 p-6">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-brand">
                          <BookOpen className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1">
                          <h3 className="mb-2 font-semibold text-foreground">{guide.title}</h3>
                          <p className="mb-4 text-sm text-muted-foreground">{guide.description}</p>
                          <Button size="sm" variant="outline" className="gap-2" asChild>
                            <a href={guide.link} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                              View Resource
                            </a>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Tools Tab */}
            <TabsContent value="tools">
              {resourcesLoading ? (
                <div className="grid gap-6 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="border-0">
                      <CardContent className="flex items-start gap-4 p-6">
                        <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
                        <div className="flex-1">
                          <Skeleton className="mb-2 h-6 w-3/4" />
                          <Skeleton className="mb-4 h-4 w-full" />
                          <Skeleton className="h-8 w-24" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {tools.map((tool) => (
                    <Card key={tool.title} className="card-elevated border-0">
                      <CardContent className="flex items-start gap-4 p-6">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-brand">
                          <Wrench className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1">
                          <h3 className="mb-2 font-semibold text-foreground">{tool.title}</h3>
                          <p className="mb-4 text-sm text-muted-foreground">{tool.description}</p>
                          <Button size="sm" variant="outline" className="gap-2" asChild>
                            <a href={tool.link} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                              Open Tool
                            </a>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Articles Tab */}
            <TabsContent value="articles">
              {resourcesLoading ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} className="border-0">
                      <CardContent className="p-6">
                        <Skeleton className="mb-4 h-6 w-24" />
                        <Skeleton className="mb-3 h-6 w-full" />
                        <Skeleton className="mb-4 h-4 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {articles.map((article) => (
                    <a key={article.title} href={article.link} target="_blank" rel="noopener noreferrer">
                    <Card className="card-elevated group cursor-pointer border-0 transition-transform hover:-translate-y-1">
                        <CardContent className="p-6">
                          <Badge className="mb-4 bg-primary/10 text-primary hover:bg-primary/20">
                            {article.category}
                          </Badge>
                          <h3 className="mb-3 text-lg font-semibold text-foreground group-hover:text-primary">
                            {article.title}
                          </h3>
                          <p className="mb-4 text-sm text-muted-foreground">{article.description}</p>
                          <div className="flex items-center gap-2 text-sm text-primary">
                            Read Article
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        </CardContent>
                    </Card>
                    </a>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Videos Tab */}
            <TabsContent value="videos">
              {resourcesLoading ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} className="border-0 overflow-hidden">
                      <Skeleton className="aspect-video w-full" />
                      <CardContent className="p-4">
                        <Skeleton className="mb-2 h-5 w-20" />
                        <Skeleton className="mb-2 h-5 w-full" />
                        <Skeleton className="h-4 w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {videos.map((video) => {
                    const thumbnailUrl = video.thumbnail?.data?.attributes?.url
                      ? `${process.env.NEXT_PUBLIC_STRAPI_URL || 'https://writewise-cms-m2xkjyh6ta-oe.a.run.app'}${video.thumbnail.data.attributes.url}`
                      : getYouTubeThumbnail(video.videoUrl);

                    return (
                      <Link key={video.slug} href={`/resources/videos/${video.slug}`}>
                        <Card className="card-elevated group cursor-pointer border-0 transition-transform hover:-translate-y-1 overflow-hidden">
                          {/* Video Thumbnail */}
                          <div className="relative aspect-video w-full overflow-hidden bg-black">
                            <img
                              src={thumbnailUrl}
                              alt={video.title}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity group-hover:bg-black/40">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-xl transition-transform group-hover:scale-110">
                                <Play className="h-5 w-5 text-primary ml-0.5" />
                              </div>
                            </div>
                            {video.duration && (
                              <div className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs font-medium text-white">
                                {video.duration}
                              </div>
                            )}
                          </div>

                          <CardContent className="p-4">
                            <Badge className="mb-2 bg-primary/10 text-xs text-primary hover:bg-primary/20">
                              {video.category}
                            </Badge>
                            <h3 className="mb-2 text-base font-semibold text-foreground group-hover:text-primary line-clamp-2">
                              {video.title}
                            </h3>
                            <p className="text-sm text-muted-foreground line-clamp-2">{video.description}</p>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* FAQ Tab */}
            <TabsContent value="faq">
              <div className="mx-auto max-w-3xl">
                {faqLoading ? (
                  <div className="space-y-8">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i}>
                        <Skeleton className="mb-4 h-8 w-48" />
                        <div className="space-y-4">
                          {Array.from({ length: 3 }).map((_, j) => (
                            <div key={j} className="rounded-lg border p-4">
                              <Skeleton className="mb-2 h-6 w-3/4" />
                              <Skeleton className="h-4 w-full" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {Object.entries(faqsByCategory).map(([category, faqs]) => {
                      if (faqs.length === 0) return null;

                      return (
                        <div key={category} className="mb-12 last:mb-0">
                          <h3 className="mb-6 text-2xl font-bold text-foreground">
                            {category} <span className="text-gradient-brand">Questions</span>
                          </h3>
                          <Accordion type="single" collapsible className="w-full">
                            {faqs.map((faq, index) => (
                              <AccordionItem key={faq.id} value={`${category}-${index}`}>
                                <AccordionTrigger className="text-left text-foreground hover:text-primary">
                                  <div className="flex items-start gap-3">
                                    <HelpCircle className="mt-1 h-5 w-5 shrink-0 text-primary" />
                                    <span>{faq.question}</span>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent className="ml-8 text-muted-foreground">
                                  {faq.answer}
                                </AccordionContent>
                              </AccordionItem>
                            ))}
                          </Accordion>
                        </div>
                      );
                    })}

                    <div className="mt-12 text-center">
                      <p className="mb-4 text-muted-foreground">
                        Can't find what you're looking for?
                      </p>
                      <Button variant="outline" asChild>
                        <a href="mailto:support@fluentina.com">
                          Contact Support
                          <ExternalLink className="ml-2 h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
            </Tabs>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-brand py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white">
            Ready to Start Learning?
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-white/80">
            Join thousands of learners improving their language skills with Fluentina.
          </p>
          <Button size="lg" variant="secondary" asChild>
            <a href="https://app.fluentina.com?mode=signup" target="_blank" rel="noopener noreferrer">
              Get Started Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
          </Button>
        </div>
      </section>
    </>
  );
};

export default Resources;
