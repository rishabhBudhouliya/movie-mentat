import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OnboardingCard } from "@/components/onboarding-card";
import { requireUser } from "@/server/auth/current-user";

// First-time only: users who already have a favorite go to the dashboard.
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.favoriteMovieId !== null) redirect("/dashboard");

  return (
    <AppShell>
      <OnboardingCard userName={user.name}>
        {/* Movie search lands with the TMDB step. */}
        <p className="text-sm text-neutral-500">Movie search is coming next.</p>
      </OnboardingCard>
    </AppShell>
  );
}
