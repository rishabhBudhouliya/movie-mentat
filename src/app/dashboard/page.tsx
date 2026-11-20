import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProfileCard } from "@/components/profile-card";
import { requireUser } from "@/server/auth/current-user";
import { getFavoriteMovie } from "@/server/movies/repository";
import { FavoriteSection } from "./favorite-section";

export default async function DashboardPage() {
  const user = await requireUser();
  const movie = await getFavoriteMovie(user);
  if (!movie) redirect("/onboarding");

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <ProfileCard
          name={user.name}
          email={user.email}
          avatarUrl={user.avatarUrl}
          logoutAction="/api/auth/logout"
        />
        {/* Server-rendered first paint; the client takes over for editing (Variant B). */}
        <FavoriteSection userId={user.id} userEmail={user.email} initialMovie={movie} />
      </div>
    </AppShell>
  );
}
