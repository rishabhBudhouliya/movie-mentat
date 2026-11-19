import type { ReactNode } from "react";

/**
 * Page chrome shared by every screen: a slim header, a centered main
 * container, and a footer carrying the required TMDB attribution.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50 text-neutral-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/70">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
          <span aria-hidden="true" className="text-lg leading-none text-amber-500">
            ★
          </span>
          <span className="text-sm font-semibold tracking-wide text-neutral-800 dark:text-zinc-100">
            Movie Memory
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
        {children}
      </main>

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
      </footer>
    </div>
  );
}
