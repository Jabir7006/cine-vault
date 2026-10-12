interface EmbedPlayerProps {
  src: string;
  title: string;
}

/**
 * Third-party embed player in an iframe. Sandboxed WITHOUT `allow-popups` /
 * `allow-top-navigation` to block the ad redirects these providers inject,
 * while keeping scripts/fullscreen so the player still works. Some providers
 * may break under the sandbox — the source selector lets the user switch.
 */
export const EmbedPlayer = ({ src, title }: EmbedPlayerProps) => (
  <div className="absolute inset-0 bg-black">
    <iframe
      key={src}
      src={src}
      title={title}
      className="absolute inset-0 h-full w-full"
      allowFullScreen
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
      referrerPolicy="origin"
    />
  </div>
);
