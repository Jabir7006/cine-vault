import type { ComponentProps, ReactNode } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

interface CarouselWrapperProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  itemClassName?: string;
  contentClassName?: string;
  className?: string;
  opts?: ComponentProps<typeof Carousel>["opts"];
  emptyMessage?: string;
}

const DEFAULT_ITEM_CLASSNAME =
  "basis-1/2 pl-3 sm:basis-1/3 sm:pl-4 md:basis-1/4 lg:basis-1/5 xl:basis-1/6";

const NAV_BUTTON_CLASSNAME =
  "size-10 rounded-full border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white";

function CarouselWrapper<T>({
  items,
  renderItem,
  keyExtractor,
  itemClassName,
  contentClassName,
  className,
  opts = { align: "start", loop: true },
  emptyMessage = "No items available right now.",
}: CarouselWrapperProps<T>) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <Carousel opts={opts} className={className}>
      <CarouselContent className={cn("-ml-3 sm:-ml-4", contentClassName)}>
        {items.map((item, index) => (
          <CarouselItem
            key={keyExtractor(item, index)}
            className={cn(DEFAULT_ITEM_CLASSNAME, itemClassName)}
          >
            {renderItem(item, index)}
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious
        className={cn("-left-3 sm:-left-5", NAV_BUTTON_CLASSNAME)}
      />
      <CarouselNext
        className={cn("-right-3 sm:-right-5", NAV_BUTTON_CLASSNAME)}
      />
    </Carousel>
  );
}

export default CarouselWrapper;
