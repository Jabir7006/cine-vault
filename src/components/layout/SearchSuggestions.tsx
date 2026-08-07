import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";

interface SearchSuggestionsProps {
  query: string;
  isOpen: boolean;
}

export const SearchSuggestions = ({ query, isOpen }: SearchSuggestionsProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="py-6 px-2"
        >
          <div className="flex flex-col items-center gap-3 text-neutral-400">
            <Search className="w-6 h-6 shrink-0" />
            <p className="text-sm text-center">
              {query.trim()
                ? `No results found for "${query.trim()}"`
                : "Type to search movies & TV shows..."
              }
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};