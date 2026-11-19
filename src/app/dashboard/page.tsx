import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FavoriteMovieCard } from "@/components/favorite-movie-card";
import { ProfileCard } from "@/components/profile-card";
import { requireUser } from "@/server/auth/current-user";
import { getFavoriteMovie } from "@/server/movies/repository";

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
        <FavoriteMovieCard movie={movie} />
      </div>
    </AppShell>
  );
}
