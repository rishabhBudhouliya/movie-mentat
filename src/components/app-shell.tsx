import type { ReactNode } from "react";
import { AppFooter } from "./app-footer";

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

      <AppFooter />
    </div>
  );
}
