import { Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { Clapperboard } from "lucide-react";

import CarouselWrapper from "@/components/common/CarouselWrapper";
import Section from "@/components/common/Section";
import SectionError from "@/components/common/SectionError";
import { streamingProvidersOptions } from "../../hooks/useHomeQueries";
import SectionHeader from "../../../../components/common/SectionHeader";
import ProviderCard from "./ProviderCard";
import ProvidersSkeleton from "./ProvidersSkeleton";

const ProvidersCarousel = () => {
  const { data: providers } = useSuspenseQuery(streamingProvidersOptions);

  return (
    <CarouselWrapper
      items={providers}
      renderItem={(provider, index) => (
        <ProviderCard provider={provider} index={index} />
      )}
      keyExtractor={(provider) => provider.id}
      emptyMessage="No streaming providers available right now."
    />
  );
};

const ProvidersSection = () => (
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

    <CatchBoundary
      getResetKey={() => "streaming-providers"}
      errorComponent={({ error, reset }) => (
        <SectionError
          error={error}
          reset={reset}
          queryKey={streamingProvidersOptions.queryKey}
          title="streaming providers"
        />
      )}
    >
      <Suspense fallback={<ProvidersSkeleton />}>
        <ProvidersCarousel />
      </Suspense>
    </CatchBoundary>
  </Section>
);

export default ProvidersSection;
