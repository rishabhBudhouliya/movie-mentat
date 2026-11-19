import type { ReactNode } from "react";

/**
 * Centered card shown to a signed-in user with no saved favorite yet. Wraps
 * the (interactive) MovieSearch as `children` so this component itself can
 * stay a plain, server-renderable shell.
 */
export function OnboardingCard({
  children,
  userName,
}: {
  children: ReactNode;
  userName: string | null;
}) {
  const firstName = userName?.split(" ")[0] ?? null;

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm sm:p-8 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-zinc-50">
          Welcome{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-neutral-600 dark:text-zinc-400">
          Pick a favorite movie and we’ll start finding spoiler-free facts about it.
        </p>
      </div>
      {children}
    </section>
  );
}
