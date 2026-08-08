export interface TMDBMediaItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview: string;
  backdrop_path: string | null;
  poster_path: string | null;
  media_type: "movie" | "tv" | string;
  genre_ids: number[];
  popularity: number;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  video?: boolean;
}

export interface TMDBResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface HeroMovie {
  id: number | string;
  title: string;
  tagline?: string;
  description: string;
  backdrop: string;
  poster?: string;
  rating: number;
  year?: number;
  duration?: string;
  ageRating?: string;
  genres?: string[];
  mediaType?: string;
  voteCount?: number;
  isFeatured?: boolean;
}

export const TMDB_GENRES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
  10759: "Action & Adventure",
  10762: "Kids",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10768: "War & Politics",
};

export const mapTMDBToHeroMovie = (item: TMDBMediaItem): HeroMovie => {
  const title =
    item.title ||
    item.name ||
    item.original_title ||
    item.original_name ||
    "Untitled";

  const releaseDate = item.release_date || item.first_air_date;
  const year = releaseDate ? new Date(releaseDate).getFullYear() : undefined;

  const backdrop = item.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
    : item.poster_path
      ? `https://image.tmdb.org/t/p/w780${item.poster_path}`
      : "";

  const poster = item.poster_path
    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
    : "";

  const genres = item.genre_ids
    ?.map((id) => TMDB_GENRES[id])
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);

  const mediaTypeLabel =
    item.media_type === "tv"
      ? "TV Series"
      : item.media_type === "movie"
        ? "Movie"
        : "";

  const tagline = mediaTypeLabel
    ? `Trending ${mediaTypeLabel}`
    : "Trending Now";

  return {
    id: item.id,
    title,
    tagline,
    description: item.overview,
    backdrop,
    poster,
    rating: item.vote_average ?? 0,
    year,
    genres,
    ageRating: item.adult ? "18+" : "PG-13",
    mediaType: item.media_type,
    voteCount: item.vote_count,
  };
};

export interface StreamingProvider {
  id: number;
  name: string;
  logoUrl: string;
  priority: number;
}
