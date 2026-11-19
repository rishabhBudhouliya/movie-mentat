import Image from "next/image";

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const word = parts[0] ?? "";
    return word.slice(0, 2).toUpperCase() || "?";
  }
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}

function localPart(email: string): string {
  return email.split("@")[0] ?? email;
}

/**
 * Account summary shown in the dashboard: avatar (with initials fallback),
 * display name (falling back to the email's local part), email, and a
 * logout form. `logoutAction` is posted to directly — no client JS needed.
 */
export function ProfileCard({
  name,
  email,
  avatarUrl,
  logoutAction,
}: {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  logoutAction: string;
}) {
  const displayName = name?.trim() || localPart(email);
  const initials = initialsFor(name, email);

  return (
    <section className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-zinc-900">
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={`${displayName}'s avatar`}
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-full border border-black/5 object-cover dark:border-white/10"
        />
      ) : (
        <div
          role="img"
          aria-label={`${displayName}'s avatar`}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-sm font-semibold text-white"
        >
          {initials}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate font-medium text-neutral-900 dark:text-zinc-50">{displayName}</p>
        <p className="truncate text-sm text-neutral-500 dark:text-zinc-400">{email}</p>
      </div>

      <form method="post" action={logoutAction}>
        <button
          type="submit"
          className="shrink-0 rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors duration-150 ease-out hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-offset-zinc-900"
        >
          Log out
        </button>
      </form>
    </section>
  );
}
