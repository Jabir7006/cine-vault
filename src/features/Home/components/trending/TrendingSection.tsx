import { Flame } from "lucide-react";

import Section from "@/components/common/Section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SectionHeader from "../../../../components/common/SectionHeader";
import TrendingTabContent from "./TrendingTabContent";

const TrendingSection = () => (
  <Section
    id="trending-heading"
    glowClassName="-top-32 -right-32 bg-amber-600/15"
    glowClassName2="-bottom-32 -left-32 bg-rose-600/15"
  >
    <SectionHeader
      id="trending-heading"
      className="mb-8 sm:mb-10"
      badgeLabel="Trending Now"
      badgeIcon={Flame}
      badgeIconClassName="text-orange-400"
      title="What everyone's watching"
      subtitle="The biggest stories of the moment, refreshed daily across movies and TV."
    />

    <Tabs defaultValue="movie">
      <TabsList>
        <TabsTrigger value="movie">Movies</TabsTrigger>
        <TabsTrigger value="tv">TV Shows</TabsTrigger>
      </TabsList>
      <TabsContent value="movie">
        <TrendingTabContent mediaType="movie" />
      </TabsContent>
      <TabsContent value="tv">
        <TrendingTabContent mediaType="tv" />
      </TabsContent>
    </Tabs>
  </Section>
);

export default TrendingSection;
