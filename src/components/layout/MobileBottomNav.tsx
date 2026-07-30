import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";

export const MobileBottomNav = () => {
  return (
    <nav
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-max w-[calc(100%-2rem)] md:hidden flex justify-center"
      aria-label="Mobile Navigation"
    >
      <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-neutral-950/90 backdrop-blur-xl border border-neutral-800/80 shadow-2xl shadow-black/80 text-neutral-300">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.to}
              asChild
              variant="ghost"
              size="icon"
              className="p-0 rounded-xl size-10 h-10 w-10 shrink-0"
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
                  "flex items-center justify-center rounded-xl transition-all duration-200"
                )}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5 shrink-0" />
              </Link>
            </Button>
          );
        })}
      </div>
    </nav>
  );
};
