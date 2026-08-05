import { Link } from "@tanstack/react-router";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";

export const DesktopNavbar = () => {
  return (
    <header className="fixed top-5 left-1/2 -translate-x-1/2 z-50 max-w-max w-[calc(100%-2rem)] hidden md:block">
      <nav className="flex items-center gap-1.5 p-1.5 rounded-full bg-neutral-950/60 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] text-neutral-300">
        {/* Brand Logo Pill */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="rounded-full px-4 py-2 h-auto hover:bg-white/5 transition-all"
        >
          <Link to="/" aria-label="CineVault Home">
            <Clapperboard className="w-4 h-4 shrink-0 text-white" />
            <span className="font-serif italic tracking-tight text-base leading-none ml-2">
              <span className="font-bold text-white">Cine</span>
              <span className="font-normal text-neutral-300">Vault</span>
            </span>
          </Link>
        </Button>
        {/* Vertical Divider */}
        <div className="h-4 w-px bg-white/10 mx-0.5" />

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
                      "bg-white/10 text-white font-semibold shadow-sm border border-white/15 backdrop-blur-md hover:bg-white/15 hover:text-white",
                  }}
                  inactiveProps={{
                    className:
                      "text-neutral-400 hover:text-neutral-100 hover:bg-white/5 border border-transparent",
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 select-none whitespace-nowrap",
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
