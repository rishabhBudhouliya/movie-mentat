/**
 * Signed-out landing screen: product name, one-line pitch, and the Google
 * sign-in entry point. Pure markup, no client interactivity needed.
 */
export function LandingHero({ signInHref }: { signInHref: string }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
      <div className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-500/20"
        >
          <FilmIcon className="h-7 w-7" />
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl dark:text-zinc-50">
          Movie Memory
        </h1>
        <p className="max-w-sm text-base text-neutral-600 sm:text-lg dark:text-zinc-400">
          Fun, spoiler-free facts about your favorite movie.
        </p>
      </div>

      <a
        href={signInHref}
        className="group inline-flex items-center gap-3 rounded-full border border-neutral-200 bg-white px-6 py-3 font-medium text-neutral-800 shadow-sm transition-colors duration-150 ease-out hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:ring-offset-zinc-950"
      >
        <GoogleIcon className="h-5 w-5" />
        Sign in with Google
      </a>
    </section>
  );
}

function FilmIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" className={className}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.5v15M16 4.5v15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2.5 9h5.5M16 9h5.5M2.5 15h5.5M16 15h5.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.47c-.28 1.5-1.13 2.77-2.41 3.62v3.01h3.86c2.26-2.08 3.6-5.15 3.6-8.66Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.92-2.91l-3.86-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.2v3.12C3.15 21.3 7.25 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27A7.17 7.17 0 0 1 4.9 12c0-.79.14-1.56.37-2.27V6.61H1.2A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.2 5.39l4.07-3.12Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.24 0 12 0 7.25 0 3.15 2.7 1.2 6.61l4.07 3.12C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}
