import Image from "next/image";
import type { ReactNode } from "react";
import { displayNameFor, initialsFor } from "@/components/profile-card";
import type { MovieSummary } from "@/components/types";

/**
 * The dashboard's slim top bar (decision 20): the Google name, email and
 * photo (with fallbacks when Google gives none), the saved favorite with its
 * Change action, and Log out. All of them are required on the dashboard.
 */
export function TopBar({
  user,
  favorite,
  action,
}: {
  user: { name: string | null; email: string; avatarUrl: string | null };
  favorite: MovieSummary;
  action: ReactNode;
}) {
  const displayName = displayNameFor(user.name, user.email);
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl bg-zinc-900/80 px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-amber-400">
          <path
            fill="currentColor"
            d="M12 2.5l2.9 6.2 6.6.7-5 4.5 1.5 6.6L12 17.2 6 20.5l1.5-6.6-5-4.5 6.6-.7z"
          />
        </svg>
        <span className="text-lg font-extrabold tracking-tight text-white">Movie Memory</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          Favorite:
          <span className="font-semibold text-zinc-100">
            {favorite.title}
            {favorite.releaseYear ? ` (${favorite.releaseYear})` : ""}
          </span>
          {action}
        </p>

        <div className="flex items-center gap-2.5">
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt={`${displayName}'s avatar`}
              width={32}
              height={32}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <span
              role="img"
              aria-label={`${displayName}'s avatar`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-white"
            >
              {initialsFor(user.name, user.email)}
            </span>
          )}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-zinc-100">{displayName}</span>
            <span className="truncate text-xs text-zinc-400">{user.email}</span>
          </span>
        </div>

        <form method="post" action="/api/auth/logout">
          <button
            type="submit"
            className="rounded-full border border-zinc-600 px-4 py-1.5 text-sm font-bold text-zinc-100 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
