import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OnboardingCard } from "@/components/onboarding-card";
import { requireUser } from "@/server/auth/current-user";
import { OnboardingSearch } from "./onboarding-search";

// First-time only: users who already have a favorite go to the dashboard.
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.favoriteMovieId !== null) redirect("/dashboard");

  return (
    <AppShell>
      <OnboardingCard userName={user.name}>
        <OnboardingSearch />
      </OnboardingCard>
    </AppShell>
  );
}
