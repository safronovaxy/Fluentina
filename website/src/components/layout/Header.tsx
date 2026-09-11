'use client';

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { Menu, X, BookOpen, ChevronDown } from "lucide-react";

// ── Simple nav links (no submenu) ────────────────────────────────────────────
const simpleNavLinks = [
  { name: "Features",    href: "/#features" },
  // Pricing intentionally hidden from nav for Phase 1 launch (ADR-8): the Stripe
  // integration is display-only with no checkout, and showing a paid-tier page
  // during the free-conversion validation window would be counterproductive.
  // The /pricing route and its plumbing are left in place, just unlinked.
  { name: "For Tutors",  href: "/for-freelancers" },
  { name: "About",       href: "/about" },
  { name: "Blog",        href: "/blog" },
  { name: "Resources",   href: "/resources" },
];

// ── "Test your language" submenu entries ────────────────────────────────────
const testLinks = [
  {
    name: "German Level Test",
    href: "/placement-test/german",
    desc: "Find your German CEFR level (A1–C2)",
    flag: "de",
  },
  {
    name: "English Level Test",
    href: "/placement-test/english",
    desc: "Find your English CEFR level (A1–C2)",
    flag: "gb",
  },
];

export const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen]     = useState(false);
  const [mobileTestOpen, setMobileTestOpen]     = useState(false);
  const pathname = usePathname();

  const isTestActive = pathname?.startsWith("/placement-test") ?? false;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="container mx-auto flex h-16 items-center justify-between px-4">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-brand">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gradient-brand">Fluentina</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:items-center md:gap-6">
          {/* Simple links before the submenu */}
          {simpleNavLinks.slice(0, 2).map((link) => (
            <Link
              key={link.name}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-primary ${
                pathname === link.href ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {link.name}
            </Link>
          ))}

          {/* "Test your language" NavigationMenu dropdown */}
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger
                  className={`h-auto bg-transparent p-0 text-sm font-medium transition-colors hover:bg-transparent hover:text-primary focus:bg-transparent focus:text-inherit data-[active]:bg-transparent data-[state=open]:bg-transparent data-[state=open]:text-inherit ${
                    isTestActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Test your language
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="w-64 p-2">
                    {testLinks.map((item) => (
                      <li key={item.href}>
                        <NavigationMenuLink asChild>
                          <Link
                            href={item.href}
                            className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-border shrink-0">
                              <img
                                src={`https://flagcdn.com/w40/${item.flag}.png`}
                                srcSet={`https://flagcdn.com/w80/${item.flag}.png 2x`}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div>
                              <p className="text-sm font-medium leading-none mb-1">{item.name}</p>
                              <p className="text-xs text-muted-foreground">{item.desc}</p>
                            </div>
                          </Link>
                        </NavigationMenuLink>
                      </li>
                    ))}
                    <li>
                      <NavigationMenuLink asChild>
                        <Link
                          href="/placement-test"
                          className="flex items-center gap-3 rounded-lg px-3 py-2 mt-1 border-t transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <p className="text-xs text-muted-foreground">See all tests →</p>
                        </Link>
                      </NavigationMenuLink>
                    </li>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          {/* Remaining simple links */}
          {simpleNavLinks.slice(2).map((link) => (
            <Link
              key={link.name}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-primary ${
                pathname === link.href ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {link.name}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex md:items-center md:gap-3">
          <Button variant="ghost" asChild>
            <a href="https://app.fluentina.com?mode=login" target="_blank" rel="noopener noreferrer">
              Sign In
            </a>
          </Button>
          <Button className="bg-gradient-brand hover:opacity-90" asChild>
            <a href="https://app.fluentina.com?mode=signup" target="_blank" rel="noopener noreferrer">
              Get Started Free
            </a>
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? (
            <X className="h-6 w-6 text-foreground" />
          ) : (
            <Menu className="h-6 w-6 text-foreground" />
          )}
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="border-t bg-background md:hidden">
          <div className="container mx-auto px-4 py-4">
            <div className="flex flex-col gap-1">
              {/* Simple links before "Test your language" */}
              {simpleNavLinks.slice(0, 2).map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`text-base font-medium px-2 py-2.5 rounded-lg transition-colors hover:text-primary ${
                    pathname === link.href ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {link.name}
                </Link>
              ))}

              {/* "Test your language" expandable */}
              <div>
                <button
                  onClick={() => setMobileTestOpen(!mobileTestOpen)}
                  className={`w-full flex items-center justify-between px-2 py-2.5 rounded-lg text-base font-medium transition-colors hover:text-primary ${
                    isTestActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  Test your language
                  <ChevronDown className={`h-4 w-4 transition-transform ${mobileTestOpen ? "rotate-180" : ""}`} />
                </button>
                {mobileTestOpen && (
                  <div className="mt-1 ml-4 flex flex-col gap-1 border-l border-border pl-4">
                    {testLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => { setMobileMenuOpen(false); setMobileTestOpen(false); }}
                        className="flex items-center gap-2 py-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                      >
                        <div className="w-6 h-6 rounded-full overflow-hidden ring-1 ring-border shrink-0">
                          <img
                            src={`https://flagcdn.com/w40/${item.flag}.png`}
                            srcSet={`https://flagcdn.com/w80/${item.flag}.png 2x`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        {item.name}
                      </Link>
                    ))}
                    <Link
                      href="/placement-test"
                      onClick={() => { setMobileMenuOpen(false); setMobileTestOpen(false); }}
                      className="py-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      See all tests →
                    </Link>
                  </div>
                )}
              </div>

              {/* Remaining simple links */}
              {simpleNavLinks.slice(2).map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`text-base font-medium px-2 py-2.5 rounded-lg transition-colors hover:text-primary ${
                    pathname === link.href ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {link.name}
                </Link>
              ))}

              <div className="mt-4 flex flex-col gap-3">
                <Button variant="outline" asChild className="w-full">
                  <a href="https://app.fluentina.com?mode=login" target="_blank" rel="noopener noreferrer">
                    Sign In
                  </a>
                </Button>
                <Button className="w-full bg-gradient-brand hover:opacity-90" asChild>
                  <a href="https://app.fluentina.com?mode=signup" target="_blank" rel="noopener noreferrer">
                    Get Started Free
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
