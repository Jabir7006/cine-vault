import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";

export const MobileBottomNav = () => {
  return (
    <nav
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-max w-[calc(100%-2rem)] md:hidden flex justify-center"
      aria-label="Mobile Bottom Navigation"
    >
      <div className="flex items-center gap-1 sm:gap-1.5 px-3 py-2 rounded-3xl bg-neutral-950/70 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.8)] text-neutral-300">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.to}
              asChild
              variant="ghost"
              size="sm"
              className="p-0 rounded-2xl h-auto"
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
                  "flex flex-col items-center justify-center min-w-14 px-3 py-1.5 rounded-2xl transition-all duration-200 gap-0.5 text-[10px] select-none",
                )}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="leading-tight font-medium">{item.label}</span>
              </Link>
            </Button>
          );
        })}
      </div>
    </nav>
  );
};
