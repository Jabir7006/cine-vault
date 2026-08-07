import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchSuggestions } from "./SearchSuggestions";

interface SearchBarProps {
  variant: "desktop" | "mobile";
}

export const SearchBar = ({ variant }: SearchBarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setQuery("");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    },
    [handleClose],
  );

  // Close on Escape key globally
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isOpen, handleClose]);

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      {/* Search Button */}
      {variant === "desktop" ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleOpen}
          className="p-0 cursor-pointer rounded-full h-auto text-neutral-400 hover:text-neutral-100 hover:bg-white/5 border border-transparent shrink-0"
          aria-label="Open search"
        >
          <span className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 select-none whitespace-nowrap">
            <Search className="w-4 h-4 shrink-0" />
            <span>Search</span>
          </span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleOpen}
          className="rounded-full border border-white/10 bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 shrink-0"
          aria-label="Open search"
        >
          <Search className="w-4 h-4" />
        </Button>
      )}

      {/* Search Overlay - rendered via portal to escape header's stacking context */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-100 flex items-start justify-center pt-[15vh] md:pt-[20vh]"
            >
              {/* Dark backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={handleClose}
              />

              {/* Search Panel */}
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.96 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative w-full max-w-2xl mx-4"
              >
                <div className="rounded-2xl bg-neutral-950/90 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
                  {/* Search Input Row */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
                    {variant === "mobile" && (
                      <button
                        onClick={handleClose}
                        className="shrink-0 text-neutral-400 hover:text-white transition-colors"
                      >
                        <ArrowLeft className="w-5 h-5" />
                      </button>
                    )}
                    <Search className="w-5 h-5 shrink-0 text-neutral-400" />
                    <Input
                      ref={inputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Search movies & TV shows..."
                      className="h-8 px-2 border-0 bg-transparent text-base text-neutral-200 placeholder:text-neutral-500 focus-visible:ring-0 shadow-none flex-1"
                    />
                    {query && (
                      <button
                        onClick={() => {
                          setQuery("");
                          inputRef.current?.focus();
                        }}
                        className="shrink-0 text-neutral-500 hover:text-neutral-200 transition-colors p-1 rounded-full hover:bg-white/5"
                        aria-label="Clear search"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={handleClose}
                      className="shrink-0 text-neutral-500 hover:text-neutral-200 transition-colors p-1 rounded-full hover:bg-white/5"
                      aria-label="Close search"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Suggestions */}
                  <div className="px-2 py-2">
                    <SearchSuggestions
                      query={query}
                      isOpen={true}
                      onSelect={handleClose}
                    />
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
};