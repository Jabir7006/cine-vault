import { Link } from "@tanstack/react-router";
import {
  Clapperboard,
  Film,
  Home,
  Sparkles,
  Tv,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Home",
    to: "/",
    icon: Home,
  },
  {
    label: "Movies",
    to: "/movies",
    icon: Film,
  },
  {
    label: "TV Shows",
    to: "/tv-shows",
    icon: Tv,
  },
  {
    label: "AI Search",
    to: "/ai-search",
    icon: Sparkles,
  },
];

const Header = () => {
  return (
    <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-max w-[calc(100%-2rem)]">
      <nav className="flex items-center gap-1 sm:gap-1.5 p-1.5 rounded-full bg-neutral-950/80 backdrop-blur-xl border border-neutral-800/80 shadow-2xl shadow-black/50 text-neutral-300">
        {/* Brand Logo */}
        <Link
          to="/"
          className="flex items-center justify-center p-2 rounded-full text-white hover:bg-neutral-800/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          aria-label="CineVault Home"
        >
          <Clapperboard className="w-5 h-5 text-white" />

          <span className="font-medium text-neutral-50 text-lg ml-2">
            CineVault
          </span>
        </Link>

        {/* Vertical Divider */}
        <div className="h-4 w-px bg-neutral-800 mx-0.5 hidden sm:block" />

        {/* Navigation Items */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{
                  className:
                    "bg-neutral-800 text-white font-semibold shadow-sm border border-neutral-700/60",
                }}
                inactiveProps={{
                  className:
                    "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent",
                }}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs sm:text-sm transition-all duration-200 select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
};

export default Header;
