import { useSuspenseQuery } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";

import Section from "@/components/common/Section";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { streamingProvidersOptions } from "../../hooks/useHomeQueries";
import SectionHeader from "../../../../components/common/SectionHeader";
import ProviderCard from "./ProviderCard";

const ProvidersSection = () => {
  const { data: providers } = useSuspenseQuery(streamingProvidersOptions);

  return (
    <Section
      id="streaming-providers-heading"
      glowClassName="-top-32 -left-32 bg-fuchsia-600/20"
      glowClassName2="-right-32 -bottom-32 bg-sky-600/20"
    >
      <SectionHeader
        id="streaming-providers-heading"
        badgeLabel="Streaming Providers"
        badgeIcon={Clapperboard}
        title="Where the story plays"
        subtitle="Stream across your favorite platforms — one account, every world, no remote required."
      />

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
    </Section>
  );
};

export default ProvidersSection;
