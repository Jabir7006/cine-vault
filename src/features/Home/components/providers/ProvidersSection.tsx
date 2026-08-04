import { useSuspenseQuery } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";

import CarouselWrapper from "@/components/common/CarouselWrapper";
import Section from "@/components/common/Section";
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

      <CarouselWrapper
        items={providers}
        renderItem={(provider, index) => (
          <ProviderCard provider={provider} index={index} />
        )}
        keyExtractor={(provider) => provider.id}
        emptyMessage="No streaming providers available right now."
      />
    </Section>
  );
};

export default ProvidersSection;
