import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

interface HeroControlsProps {
  onPrev: () => void;
  onNext: () => void;
}

const HeroControls = ({ onPrev, onNext }: HeroControlsProps) => (
  <div className="flex items-center gap-2">
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onPrev}
      aria-label="Previous slide"
      className="size-10 rounded-full border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white sm:size-11"
    >
      <ChevronLeft className="size-5" />
    </Button>
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onNext}
      aria-label="Next slide"
      className="size-10 rounded-full border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white sm:size-11"
    >
      <ChevronRight className="size-5" />
    </Button>
  </div>
);

export default HeroControls;
