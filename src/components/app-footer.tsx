/**
 * Site footer: the TMDB attribution their terms require, and the privacy
 * policy Google's branding review requires. Shared by every page.
 */
export function AppFooter() {
  return (
    <footer className="border-t border-black/5 py-6 text-center text-xs text-neutral-500 dark:border-white/10 dark:text-zinc-500">
      <p className="mx-auto max-w-3xl px-4 sm:px-6">
        This product uses the TMDB API but is not endorsed or certified by{" "}
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 hover:text-amber-600 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-amber-400"
        >
          TMDB
        </a>
        .
      </p>
      <p className="mx-auto mt-2 max-w-3xl px-4 sm:px-6">
        <a
          href="/privacy"
          className="underline underline-offset-2 hover:text-amber-600 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-amber-400"
        >
          Privacy policy
        </a>
      </p>
    </footer>
  );
}
