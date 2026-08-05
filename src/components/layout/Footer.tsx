import { Link } from "@tanstack/react-router";
import { Clapperboard, Globe, Heart, Mail, Share2 } from "lucide-react";

import { NAV_ITEMS } from "@/config/navigation";

const SOCIAL_LINKS = [
  {
    label: "GitHub",
    icon: Globe,
    href: "https://github.com/Jabir7006/cine-vault",
  },
  { label: "Email", icon: Mail, href: "mailto:hello@cinevault.app" },
  { label: "Share", icon: Share2, href: "https://twitter.com" },
] as const;

const RESOURCE_LINKS = [
  { label: "TMDB API", href: "https://www.themoviedb.org/api" },
  { label: "About", href: "#" },
  { label: "Privacy", href: "#" },
  { label: "Terms", href: "#" },
] as const;

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative mt-auto border-t border-white/10 bg-neutral-950/80 backdrop-blur-2xl">
      {/* Subtle top glow */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 size-64 rounded-full bg-white/5 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link
              to="/"
              aria-label="CineVault Home"
              className="inline-flex items-center gap-2"
            >
              <Clapperboard className="size-5 text-neutral-300" />
              <span className="font-serif italic tracking-tight text-lg leading-none">
                <span className="font-bold text-white">Cine</span>
                <span className="font-normal text-neutral-300">Vault</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-neutral-400">
              Your cinematic vault. Discover trending movies, TV shows, and
              critically acclaimed classics — all in one place.
            </p>
          </div>

          {/* Navigation */}
          <nav aria-label="Footer Navigation">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Explore
            </h3>
            <ul className="space-y-3">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    activeOptions={{ exact: item.to === "/" }}
                    className="text-sm text-neutral-400 transition-colors duration-200 hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Resources */}
          <nav aria-label="Resources">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Resources
            </h3>
            <ul className="space-y-3">
              {RESOURCE_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-neutral-400 transition-colors duration-200 hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Social */}
          <div>
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Connect
            </h3>
            <div className="flex items-center gap-3">
              {SOCIAL_LINKS.map(({ label, icon: Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-400 backdrop-blur-md transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-xs text-neutral-500">
            &copy; {currentYear} CineVault. All rights reserved.
          </p>
          <p className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
            Built with
            <Heart className="size-3.5 fill-rose-500 text-rose-500" />
            using TMDB
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
