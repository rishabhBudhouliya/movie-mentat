import Image from "next/image";

/**
 * Shared poster rendering used by MovieSearch results/ambiguous cards and
 * FavoriteMovieCard. Not part of the required export list, but factored out
 * so the "no image → initials tile" fallback rule is implemented once.
 */

const SIZES = {
  sm: { width: 46, height: 69, textClass: "text-xs" },
  lg: { width: 120, height: 180, textClass: "text-2xl" },
} as const;

export type PosterSize = keyof typeof SIZES;

function initialsFor(title: string): string {
  const words = title
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : (words[0]?.[1] ?? "");
  return `${first}${second}`.toUpperCase() || "?";
}

export function MoviePoster({
  title,
  posterUrl,
  size = "sm",
}: {
  title: string;
  posterUrl: string | null;
  size?: PosterSize;
}) {
  const { width, height, textClass } = SIZES[size];

  if (posterUrl) {
    return (
      <Image
        src={posterUrl}
        alt={`Poster for ${title}`}
        width={width}
        height={height}
        className="shrink-0 rounded-md border border-black/10 object-cover shadow-sm dark:border-white/10"
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={`No poster available for ${title}`}
      style={{ width, height }}
      className={`flex shrink-0 items-center justify-center rounded-md border border-amber-900/10 bg-gradient-to-br from-amber-100 to-amber-200 font-semibold text-amber-800 dark:border-amber-200/10 dark:from-zinc-700 dark:to-zinc-800 dark:text-amber-200 ${textClass}`}
    >
      {initialsFor(title)}
    </div>
  );
}
