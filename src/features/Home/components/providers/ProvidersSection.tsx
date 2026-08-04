import { useSuspenseQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Clapperboard } from "lucide-react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { streamingProvidersOptions } from "../../hooks/useHomeQueries";
import { EASE_CINEMATIC } from "../hero/animations";
import ProviderCard from "./ProviderCard";

const ProvidersSection = () => {
  const { data: providers } = useSuspenseQuery(streamingProvidersOptions);

  return (
    <section
      aria-labelledby="streaming-providers-heading"
      className="relative overflow-hidden bg-neutral-950 py-16 sm:py-24"
    >
      <div className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-fuchsia-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 -bottom-32 size-96 rounded-full bg-sky-600/20 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE_CINEMATIC }}
          className="mb-10 flex flex-col gap-3 sm:mb-12"
        >
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-300 backdrop-blur-md">
            <Clapperboard className="size-3.5" />
            Streaming Providers
          </span>
          <h2
            id="streaming-providers-heading"
            className="font-serif text-3xl font-bold italic tracking-tight text-white sm:text-4xl lg:text-5xl"
          >
            Where the story plays
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-neutral-400 sm:text-base">
            Stream across your favorite platforms — one account, every world, no
            remote required.
          </p>
        </motion.header>

        {providers.length > 0 ? (
          <Carousel opts={{ align: "start", loop: true }}>
            <CarouselContent className="-ml-3 sm:-ml-4">
              {providers.map((provider, index) => (
                <CarouselItem
                  key={provider.id}
                  className="basis-1/2 pl-3 sm:basis-1/3 sm:pl-4 md:basis-1/4 lg:basis-1/5 xl:basis-1/6"
                >
                  <ProviderCard provider={provider} index={index} />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="-left-3 size-10 rounded-full border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white sm:-left-5" />
            <CarouselNext className="-right-3 size-10 rounded-full border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white sm:-right-5" />
          </Carousel>
        ) : (
          <p className="text-sm text-neutral-500">
            No streaming providers available right now.
          </p>
        )}
      </div>
    </section>
  );
};

export default ProvidersSection;