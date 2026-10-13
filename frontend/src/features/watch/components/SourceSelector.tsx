import { useId } from "react";
import type { Source } from "../types";

interface SourceSelectorProps {
  sources: Source[];
  selected: string | undefined;
  moviebox: { available: boolean; optionLabel: string };
  onSelect: (provider: string) => void;
}

export const SourceSelector = ({ sources, selected, moviebox, onSelect }: SourceSelectorProps) => {
  const id = useId();

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
      <label htmlFor={id} className="text-xs font-medium text-neutral-400">Source</label>
      <select
        id={id}
        value={selected ?? ""}
        disabled={sources.length === 0}
        onChange={(event) => onSelect(event.target.value)}
        className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:text-neutral-500 sm:w-40 sm:flex-none"
      >
        {sources.length === 0 ? <option value="">Unavailable</option> : null}
        {!moviebox.available ? <option value="moviebox" disabled>{moviebox.optionLabel}</option> : null}
        {sources.map((source) => (
          <option key={source.provider} value={source.provider}>{source.label}</option>
        ))}
      </select>
    </div>
  );
};
