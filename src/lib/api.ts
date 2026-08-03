import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_TMDB_API_URL,
  headers: {
    Authorization: `Bearer ${import.meta.env.VITE_TMDB_API_KEY}`,
  },
});

export default api;
