import Image from "next/image";

/** An actor's photo in a ring of their direction's color, or their initials. */
export function Avatar({
  name,
  url,
  color,
  size = 44,
}: {
  name: string;
  url: string | null;
  color: string;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-xs font-extrabold text-zinc-100"
      style={{ width: size, height: size, boxShadow: `0 0 0 3px ${color}` }}
    >
      {url ? (
        <Image src={url} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
