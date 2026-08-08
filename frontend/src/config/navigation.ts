import { Film, Home, Sparkles, Tv, type LucideIcon } from "lucide-react";

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
