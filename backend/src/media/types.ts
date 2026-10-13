export interface MediaResource {
  url: string;
  kind: "video" | "subtitle";
  headers: Readonly<Record<string, string>>;
  expiresAt?: number;
  height?: number;
  codec?: string;
  resourceId?: string;
  lang?: string;
  label?: string;
  captionFormat?: "srt" | "vtt";
}

export interface MediaTransport {
  probe(resource: MediaResource, signal?: AbortSignal): Promise<boolean>;
  caption(resource: MediaResource, signal?: AbortSignal): Promise<string>;
  relay(resource: MediaResource, method: "GET" | "HEAD", range?: string, signal?: AbortSignal): Promise<Response>;
}

export interface MediaRegistry {
  register(resource: MediaResource, expiresAt: number): string;
  resolve(token: string, method: string): MediaResource | undefined;
  revoke(token: string): void;
}
