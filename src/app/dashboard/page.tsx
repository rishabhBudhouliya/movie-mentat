import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { getFavoriteMovie } from "@/server/movies/repository";
import { DashboardScreen } from "./dashboard-screen";

export default async function DashboardPage() {
  const user = await requireUser();
  const movie = await getFavoriteMovie(user);
  if (!movie) redirect("/onboarding");

  // Server-rendered first paint; the client takes over for editing (Variant B)
  // and the graph.
  return (
    <DashboardScreen
      userId={user.id}
      user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl }}
      initialMovie={movie}
    />
  );
}
