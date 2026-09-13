'use client';

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Calendar, Clock, User, Share2, Bookmark, ThumbsUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import type { BlogPost } from "@/types/strapi";

interface Props {
  post: BlogPost;
  relatedPosts: Array<{ slug: string; title: string; category: string }>;
}

const BlogPostPage = ({ post, relatedPosts }: Props) => {
  const imageUrl =
    post.featuredImage?.url ||
    'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=600&fit=crop';

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-brand-subtle py-8">
        <div className="container mx-auto px-4">
          <Button variant="ghost" size="sm" asChild className="mb-6">
            <Link href="/blog">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Blog
            </Link>
          </Button>

          <div className="mx-auto max-w-3xl">
            <Badge className="mb-4 bg-primary/10 text-primary">{post.category}</Badge>
            <h1 className="mb-6 text-3xl font-bold text-foreground md:text-4xl lg:text-5xl">
              {post.title}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {post.author}
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {new Date(post.publishedDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {post.readTime}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Image */}
      <section className="py-8">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl overflow-hidden rounded-xl">
            <img
              src={imageUrl}
              alt={post.featuredImage?.alternativeText || post.title}
              className="h-auto w-full object-cover"
              data-pin-description={post.excerpt || post.title}
              data-pin-url={`https://fluentina.com/blog/${post.slug}`}
              data-pin-media={imageUrl}
            />
          </div>
        </div>
      </section>

      {/* Article Content */}
      <section className="py-8">
        <div className="container mx-auto px-4">
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_280px]">
            {/* Main Content */}
            <article className="prose max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeRaw]}
              >
                {post.content || ''}
              </ReactMarkdown>
            </article>

            {/* Sidebar */}
            <aside className="space-y-6">
              {/* Share Actions */}
              <Card className="card-elevated border-0">
                <CardContent className="p-4">
                  <h3 className="mb-4 font-semibold text-foreground">Share Article</h3>
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon">
                      <Share2 className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <Bookmark className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <ThumbsUp className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Author Card */}
              <Card className="card-elevated border-0">
                <CardContent className="p-4">
                  <h3 className="mb-3 font-semibold text-foreground">About the Author</h3>
                  <p className="mb-2 font-medium text-foreground">{post.author}</p>
                  {post.authorRole && (
                    <p className="text-sm text-muted-foreground">{post.authorRole}</p>
                  )}
                </CardContent>
              </Card>

              {/* Related Posts */}
              {relatedPosts.length > 0 && (
                <Card className="card-elevated border-0">
                  <CardContent className="p-4">
                    <h3 className="mb-4 font-semibold text-foreground">Related Articles</h3>
                    <div className="space-y-3">
                      {relatedPosts.map((related) => (
                        <Link
                          key={related.slug}
                          href={`/blog/${related.slug}`}
                          className="block rounded-lg p-2 transition-colors hover:bg-muted"
                        >
                          <Badge className="mb-1 bg-primary/10 text-xs text-primary">
                            {related.category}
                          </Badge>
                          <p className="text-sm font-medium text-foreground hover:text-primary">
                            {related.title}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </aside>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-brand py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-2xl font-bold text-white md:text-3xl">
            Ready to Improve Your Writing?
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-white/80">
            Join thousands of learners using Fluentina to master language skills.
          </p>
          <Button size="lg" variant="secondary" asChild>
            <a
              href="https://app.fluentina.com?mode=signup"
              target="_blank"
              rel="noopener noreferrer"
            >
              Start Learning Free
            </a>
          </Button>
        </div>
      </section>
    </>
  );
};

export default BlogPostPage;
