import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = { title: "Privacy · Movie Memory" };

// Plain statement of what the app actually stores (see prisma/schema.prisma).
export default function PrivacyPage() {
  return (
    <AppShell>
      <article className="prose-sm flex max-w-2xl flex-col gap-4 text-neutral-700 dark:text-zinc-300">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-zinc-50">
          Privacy policy
        </h1>
        <p>
          Movie Memory is a small demo app built as a take-home exercise. This page describes
          everything it collects and why.
        </p>

        <h2 className="text-lg font-semibold text-neutral-900 dark:text-zinc-50">What we store</h2>
        <ul className="list-disc pl-5">
          <li>
            From Google sign-in: your Google account ID, email address, name, and profile photo URL.
            We use these only to sign you in and show your profile on the dashboard.
          </li>
          <li>Your favorite movie (its catalog ID, title, year, and poster path).</li>
          <li>The movie facts generated for you, with the time each was created.</li>
          <li>
            A session record that lets you stay signed in. Your browser holds a random token; we
            store only a hash of it, and it expires after 14 days or when you log out.
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-900 dark:text-zinc-50">
          What we don&apos;t do
        </h2>
        <p>
          We don&apos;t sell or share your information, show ads, or use tracking or analytics
          cookies. The only cookies are the sign-in session and a short-lived cookie used during
          Google sign-in.
        </p>

        <h2 className="text-lg font-semibold text-neutral-900 dark:text-zinc-50">
          Services involved
        </h2>
        <ul className="list-disc pl-5">
          <li>Google, to sign you in.</li>
          <li>
            OpenAI, which receives your favorite movie&apos;s title and year to write a fact. None
            of your personal details are sent.
          </li>
          <li>TMDB, which receives the movie titles you search for.</li>
          <li>Vercel (hosting) and Neon (database), which store and serve the data above.</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-900 dark:text-zinc-50">
          Deleting your data
        </h2>
        <p>
          To have your account and everything above deleted, open an issue at{" "}
          <a
            className="font-medium text-amber-700 underline underline-offset-2 dark:text-amber-400"
            href="https://github.com/rishabhBudhouliya/movie-mentat/issues"
          >
            github.com/rishabhBudhouliya/movie-mentat
          </a>
          .
        </p>
      </article>
    </AppShell>
  );
}
