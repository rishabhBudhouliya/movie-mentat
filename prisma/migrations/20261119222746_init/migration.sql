-- CreateTable
CREATE TABLE "movies" (
    "tmdb_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "release_year" INTEGER,
    "poster_path" TEXT,

    CONSTRAINT "movies_pkey" PRIMARY KEY ("tmdb_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "google_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "favorite_movie_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "facts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_gen_states" (
    "user_id" UUID NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "attempt_no" INTEGER NOT NULL DEFAULT 0,
    "failed_attempt_no" INTEGER,
    "failed_at" TIMESTAMPTZ(6),

    CONSTRAINT "fact_gen_states_pkey" PRIMARY KEY ("user_id","movie_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "facts_user_id_movie_id_created_at_idx" ON "facts"("user_id", "movie_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_favorite_movie_id_fkey" FOREIGN KEY ("favorite_movie_id") REFERENCES "movies"("tmdb_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("tmdb_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_gen_states" ADD CONSTRAINT "fact_gen_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_gen_states" ADD CONSTRAINT "fact_gen_states_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("tmdb_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma doesn't model these).
-- Impossible states can't be stored (PLAN.md, "Type-level design").

-- A failure is recorded as a pair: both columns set, or both null.
ALTER TABLE "fact_gen_states" ADD CONSTRAINT "fact_gen_states_failure_pair"
  CHECK (("failed_attempt_no" IS NULL) = ("failed_at" IS NULL));

-- A failed attempt must be one that was actually started (TLA+ F1 ordering).
ALTER TABLE "fact_gen_states" ADD CONSTRAINT "fact_gen_states_failed_attempt_started"
  CHECK ("failed_attempt_no" IS NULL OR "failed_attempt_no" BETWEEN 1 AND "attempt_no");

ALTER TABLE "fact_gen_states" ADD CONSTRAINT "fact_gen_states_attempt_no_nonnegative"
  CHECK ("attempt_no" >= 0);

-- Only successful, non-empty facts are stored.
ALTER TABLE "facts" ADD CONSTRAINT "facts_text_nonempty" CHECK (length(btrim("text")) > 0);

ALTER TABLE "movies" ADD CONSTRAINT "movies_title_nonempty" CHECK (length(btrim("title")) > 0);

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_expiry_after_creation" CHECK ("expires_at" > "created_at");
