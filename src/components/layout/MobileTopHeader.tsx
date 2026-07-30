import { Link } from "@tanstack/react-router";
import { Clapperboard, Moon, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export const MobileTopHeader = () => {
  return (
    <header className="fixed top-3 inset-x-4 z-50 md:hidden">
      <div className="flex items-center justify-between px-3.5 py-2 rounded-2xl bg-neutral-950/85 backdrop-blur-xl border border-neutral-800/80 shadow-xl text-neutral-300">
        {/* Brand Logo */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="p-1 rounded-full text-white hover:bg-neutral-800/80 hover:text-white"
        >
          <Link to="/" aria-label="CineVault Home">
            <Clapperboard className="w-5 h-5 text-white" />
          </Link>
        </Button>

        {/* Top Header Utilities */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-neutral-400 hover:text-white hover:bg-neutral-800/60 rounded-full"
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className="text-neutral-400 hover:text-white hover:bg-neutral-800/60 rounded-full"
            aria-label="Theme toggle"
          >
            <Moon className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className="text-neutral-400 hover:text-white hover:bg-neutral-800/60 rounded-full"
            aria-label="User profile"
          >
            <User className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};
