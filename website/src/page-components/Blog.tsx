'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEO } from "@/components/SEO";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Calendar, Clock, User } from "lucide-react";
import { useBlogPosts } from "@/hooks/use-strapi";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { StrapiResponse, BlogPost } from "@/types/strapi";

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL || 'https://writewise-cms-m2xkjyh6ta-oe.a.run.app';

interface BlogProps {
  initialData?: StrapiResponse<BlogPost[]>;
}

const Blog = ({ initialData }: BlogProps = {}) => {
  const { data: fetchedData, isLoading: blogLoading } = useBlogPosts();
  const blogData = fetchedData ?? initialData;
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  const allPosts = blogData?.data.map(item => {
    const post = item;
    const imageUrl = post.featuredImage?.url
      || 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=400&fit=crop';

    return {
      title: post.title,
      excerpt: post.excerpt,
      author: post.author,
      authorRole: post.authorRole,
      date: new Date(post.publishedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      readTime: post.readTime,
      category: post.category,
      image: imageUrl,
      slug: post.slug,
      featured: post.featured || false,
    };
  }) || [];

  // Separate featured post
  const featuredPost = allPosts.find(post => post.featured) || allPosts[0];

  // Regular posts (excluding featured)
  const regularPosts = allPosts.filter(post => post !== featuredPost);

  // Filter posts by category
  const filteredPosts = selectedCategory === "All"
    ? regularPosts
    : regularPosts.filter(post => post.category === selectedCategory);

  // Extract unique categories from posts
  const categories = ["All", ...Array.from(new Set(allPosts.map(post => post.category)))];

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newsletterEmail) return;

    setNewsletterLoading(true);
    try {
      const response = await fetch(`${STRAPI_URL}/api/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newsletterEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to subscribe');
      }

      toast.success(data.message || "You're subscribed! Welcome to the Fluentina newsletter.");
      setNewsletterEmail("");
    } catch (error) {
      console.error('Newsletter error:', error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setNewsletterLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="Fluentina Blog - Language Learning Tips & AI Insights"
        description="Expert articles on language learning, AI technology, and effective communication. Tips for intermediate learners (A2-C1)."
        keywords="language learning blog, AI language learning, writing tips, CEFR"
        ogType="website"
      />
      {/* Hero */}
      <section className="bg-gradient-brand-subtle py-16">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="mb-4 text-4xl font-bold text-foreground md:text-5xl">
              Fluentina <span className="text-gradient-brand">Blog</span>
            </h1>
            <p className="text-lg text-muted-foreground">
              Insights, tips, and research on language learning, AI technology, and effective communication.
            </p>
          </div>
        </div>
      </section>

      {/* Featured Post */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          {blogLoading ? (
            <Card className="overflow-hidden border-0">
              <div className="grid md:grid-cols-2">
                <Skeleton className="aspect-video md:aspect-auto md:h-full" />
                <CardContent className="flex flex-col justify-center p-8">
                  <Skeleton className="mb-4 h-6 w-24" />
                  <Skeleton className="mb-4 h-8 w-full" />
                  <Skeleton className="mb-2 h-4 w-full" />
                  <Skeleton className="mb-6 h-4 w-3/4" />
                  <div className="mb-6 flex flex-wrap gap-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-10 w-32" />
                </CardContent>
              </div>
            </Card>
          ) : featuredPost ? (
            <Card className="card-elevated overflow-hidden border-0">
              <div className="grid md:grid-cols-2">
                <div className="aspect-video bg-gradient-brand md:aspect-auto">
                  <img
                    src={featuredPost.image}
                    alt={featuredPost.title}
                    className="h-full w-full object-cover"
                  />
                </div>
                <CardContent className="flex flex-col justify-center p-8">
                  <Badge className="mb-4 w-fit bg-primary/10 text-primary hover:bg-primary/20">
                    {featuredPost.category}
                  </Badge>
                  <h2 className="mb-4 text-2xl font-bold text-foreground md:text-3xl">
                    {featuredPost.title}
                  </h2>
                  <p className="mb-6 text-muted-foreground">{featuredPost.excerpt}</p>
                  <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      {featuredPost.author}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {featuredPost.date}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {featuredPost.readTime}
                    </div>
                  </div>
                  <Button className="w-fit bg-gradient-brand hover:opacity-90" asChild>
                    <Link href={`/blog/${featuredPost.slug}`}>
                      Read Article
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </div>
            </Card>
          ) : null}
        </div>
      </section>

      {/* Categories */}
      <section className="border-y py-6">
        <div className="container mx-auto px-4">
          {blogLoading ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-24" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {categories.map((category) => (
                <Button
                  key={category}
                  variant={selectedCategory === category ? "default" : "outline"}
                  size="sm"
                  className={selectedCategory === category ? "bg-gradient-brand hover:opacity-90" : ""}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </Button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Posts Grid */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {blogLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="border-0">
                  <CardContent className="p-6">
                    <Skeleton className="mb-4 h-6 w-24" />
                    <Skeleton className="mb-3 h-6 w-full" />
                    <Skeleton className="mb-2 h-4 w-full" />
                    <Skeleton className="mb-4 h-4 w-3/4" />
                    <div className="flex flex-wrap gap-4">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              filteredPosts.map((post) => (
                <Link key={post.slug} href={`/blog/${post.slug}`} className="flex">
                  <Card className="card-elevated group flex flex-col cursor-pointer border-0 transition-transform hover:-translate-y-1 w-full">
                    <CardContent className="flex flex-col flex-1 p-6">
                      <Badge className="mb-4 w-fit bg-primary/10 text-primary hover:bg-primary/20">
                        {post.category}
                      </Badge>
                      <h3 className="mb-3 text-xl font-semibold text-foreground group-hover:text-primary">
                        {post.title}
                      </h3>
                      <p className="mb-4 flex-1 text-sm text-muted-foreground">{post.excerpt}</p>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {post.author}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {post.date}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {post.readTime}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Newsletter */}
      <section className="bg-muted/30 py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground">
            Subscribe to Our <span className="text-gradient-brand">Newsletter</span>
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
            Get weekly tips, insights, and resources delivered straight to your inbox.
          </p>
          <form
            onSubmit={handleNewsletterSubmit}
            className="mx-auto flex max-w-md flex-col gap-3 sm:flex-row"
          >
            <input
              type="email"
              placeholder="Enter your email"
              value={newsletterEmail}
              onChange={(e) => setNewsletterEmail(e.target.value)}
              required
              disabled={newsletterLoading}
              className="flex-1 rounded-lg border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <Button
              type="submit"
              disabled={newsletterLoading}
              className="bg-gradient-brand px-8 hover:opacity-90 disabled:opacity-50"
            >
              {newsletterLoading ? "Subscribing..." : "Subscribe"}
            </Button>
          </form>
        </div>
      </section>
    </>
  );
};

export default Blog;
