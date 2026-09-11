import Link from "next/link";
import { BookOpen, Twitter, Linkedin, Youtube, Mail } from "lucide-react";

const footerLinks = {
  product: [
    { name: "Features",  href: "/#features" },
    // Pricing intentionally hidden from nav for Phase 1 (ADR-8) — see Header.tsx.
    { name: "Blog",      href: "/blog" },
    { name: "Resources", href: "/resources" },
  ],
  tests: [
    { name: "German Level Test",  href: "/placement-test/german" },
    { name: "English Level Test", href: "/placement-test/english" },
    { name: "All Level Tests",    href: "/placement-test" },
  ],
  company: [
    { name: "About",    href: "/about" },
    { name: "Careers",  href: "/about#careers" },
    { name: "Contact",  href: "/contact" },
  ],
  legal: [
    { name: "Privacy Policy",   href: "/privacy-policy" },
    { name: "Terms of Service", href: "/user-agreement" },
  ],
};

const socialLinks = [
  { name: "Twitter", icon: Twitter, href: "https://twitter.com" },
  { name: "LinkedIn", icon: Linkedin, href: "https://www.linkedin.com/company/write-wise-language-improvement/" },
  { name: "YouTube", icon: Youtube, href: "https://www.youtube.com/@write-wise" },
  { name: "Email", icon: Mail, href: "mailto:support@fluentina.com" },
];

export const Footer = () => {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-6">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-brand">
                <BookOpen className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gradient-brand">Fluentina</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Your AI-powered language learning mentor. Master your active language and communication through writing with personalized feedback.
            </p>
            <div className="mt-6 flex gap-4">
              {socialLinks.map((social) => (
                <a
                  key={social.name}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                  aria-label={social.name}
                >
                  <social.icon className="h-5 w-5" />
                </a>
              ))}
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="mb-4 font-semibold text-foreground">Product</h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Tests Links */}
          <div>
            <h3 className="mb-4 font-semibold text-foreground">Level Tests</h3>
            <ul className="space-y-3">
              {footerLinks.tests.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h3 className="mb-4 font-semibold text-foreground">Company</h3>
            <ul className="space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="mb-4 font-semibold text-foreground">Legal</h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-12 border-t pt-8">
          <p className="text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Fluentina. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
