import { Link } from "@tanstack/react-router";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";

export const DesktopNavbar = () => {
  return (
    <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-max w-[calc(100%-2rem)] hidden md:block">
      <nav className="flex items-center gap-1 sm:gap-1.5 p-1.5 rounded-full bg-neutral-950/80 backdrop-blur-xl border border-neutral-800/80 shadow-2xl shadow-black/50 text-neutral-300">
        {/* Brand Logo */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="rounded-full px-3 text-white hover:bg-neutral-800/80 hover:text-white"
        >
          <Link to="/" aria-label="CineVault Home">
            <Clapperboard className="w-5 h-5 text-white" />
            <span className="font-semibold text-neutral-50 text-base ml-2">
              CineVault
            </span>
          </Link>
        </Button>

        {/* Vertical Divider */}
        <div className="h-4 w-px bg-neutral-800 mx-0.5" />

        {/* Navigation Items */}
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.to}
                asChild
                variant="ghost"
                size="sm"
                className="p-0 rounded-full h-auto"
              >
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  activeProps={{
                    className:
                      "bg-neutral-800 text-white font-semibold shadow-sm border border-neutral-700/60 hover:bg-neutral-800 hover:text-white",
                  }}
                  inactiveProps={{
                    className:
                      "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent",
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm transition-all duration-200 select-none whitespace-nowrap"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </Button>
            );
          })}
        </div>
      </nav>
    </header>
  );
};
