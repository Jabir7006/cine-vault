import HeroCarousel from "./components/hero/HeroCarousel";
import ProvidersSection from "./components/providers/ProvidersSection";
import TopRatedMoviesSection from "./components/top-rated/TopRatedMoviesSection";
import TrendingSection from "./components/trending/TrendingSection";

const HomeComponent = () => (
  <>
    <HeroCarousel />
    <ProvidersSection />
    <TrendingSection />
    <TopRatedMoviesSection />
  </>
);

export default HomeComponent;
