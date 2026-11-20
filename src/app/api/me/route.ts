import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { unauthorized, withApiErrors } from "@/server/http";
import { getFavoriteMovie } from "@/server/movies/repository";

// The signed-in user's profile and saved favorite. Internal IDs stay
// server-side (PLAN.md, "Explicit public data types").
export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return NextResponse.json({
    user: { name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    favoriteMovie: await getFavoriteMovie(user),
  });
});
