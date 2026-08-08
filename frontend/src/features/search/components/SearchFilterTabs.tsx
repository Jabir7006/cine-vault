import { Clapperboard, Film, Tv } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SearchFilter } from "../types";

interface SearchFilterTabsProps {
  value: SearchFilter;
  onValueChange: (value: SearchFilter) => void;
}

const FILTERS: { value: SearchFilter; label: string; icon: typeof Film }[] = [
  { value: "all", label: "Movies & TV", icon: Clapperboard },
  { value: "movie", label: "Movie", icon: Film },
  { value: "tv", label: "TV Series", icon: Tv },
];

export const SearchFilterTabs = ({
  value,
  onValueChange,
}: SearchFilterTabsProps) => (
  <Tabs value={value} onValueChange={(v) => onValueChange(v as SearchFilter)}>
    <TabsList className="w-full">
      {FILTERS.map(({ value: filterValue, label, icon: Icon }) => (
        <TabsTrigger key={filterValue} value={filterValue} className="flex-1">
          <Icon className="size-3.5" />
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  </Tabs>
);