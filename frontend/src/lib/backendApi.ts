import axios from "axios";

/**
 * Axios instance for the cine-vault backend (streaming sources + relay).
 * Separate from the TMDB `api` instance in `./api`.
 */
export const backendApi = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8787",
});

const token = import.meta.env.VITE_BACKEND_TOKEN;
if (token) {
  backendApi.defaults.headers.common["x-access-token"] = token;
}

export default backendApi;
