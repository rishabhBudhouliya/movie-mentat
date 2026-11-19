import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ErrorNotice } from "@/components/error-notice";
import { LandingHero } from "@/components/landing-hero";
import { getCurrentUser } from "@/server/auth/current-user";

const LOGIN_ERRORS: Record<string, string> = {
  login_failed: "Google sign-in didn't complete. Please try again.",
  login_expired: "That sign-in attempt expired. Please try again.",
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(user.favoriteMovieId === null ? "/onboarding" : "/dashboard");

  const { error } = await searchParams;
  const message = typeof error === "string" ? LOGIN_ERRORS[error] : undefined;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {message ? <ErrorNotice title="Sign-in failed" message={message} /> : null}
        <LandingHero signInHref="/api/auth/login" />
      </div>
    </AppShell>
  );
}
