export interface HeroMovie {
  id: string;
  title: string;
  tagline: string;
  description: string;
  backdrop: string;
  rating: number;
  year: number;
  duration: string;
  ageRating: string;
  genres: string[];
  isFeatured?: boolean;
}
