import { Link } from "@tanstack/react-router";
import { Clapperboard, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export const MobileTopHeader = () => {
  return (
    <header className="fixed top-4 inset-x-4 z-50 md:hidden">
      <div className="flex items-center justify-between px-4 py-2 rounded-full bg-neutral-950/60 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] text-neutral-300">
        {/* Brand Logo */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="p-0 h-auto font-semibold text-white hover:bg-transparent"
        >
          <Link to="/" aria-label="CineVault Home" className="flex items-center gap-2">
            <Clapperboard className="w-5 h-5 text-white" />
            <span className="font-semibold text-white text-base tracking-tight italic">
              CineVault
            </span>
          </Link>
        </Button>

        {/* User Profile Button */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-8 rounded-full border border-white/15 bg-white/5 text-neutral-300 hover:text-white hover:bg-white/10"
          aria-label="User profile"
        >
          <User className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
};
