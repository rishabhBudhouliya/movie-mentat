# Movie Memory product decisions

Build the base experience and both variants. Complete and verify Variant A before implementing Variant B. The exercise asks for one extension, so present A as the core submission and B as the layer built on top. The exercise PDF governs required features and deliverables.

## Base experience and movie identity

- Signed-out visitors see “Sign in with Google” at the landing page. Protect the dashboard. After sign-in, send users without a saved favorite to onboarding and everyone else to the dashboard.
- The dashboard shows the user's Google name, email, photo when available, saved favorite, fact, and logout action. Handle a missing name or photo gracefully.
- Use TMDB as the catalog for movie identity. Trim movie input and enforce minimum and maximum lengths on the server. Validate the selected catalog entry server-side. Save its ID, title, and release year in Postgres so a returning user can view their favorite during a catalog outage.
- Typing searches. Selecting a result commits the choice during onboarding and selects a draft during inline editing. Submitting an exact title and year with one match goes straight through. For ambiguous input such as *Dune*, show the two best candidates as selectable cards with title and year, a poster when available, and a way to edit the search. The cards must be distinguishable without images.
- Require a catalog match. A successful empty search says “No match found. Try another title or add a release year.” An unavailable catalog gets a service error and retry action. Preserve the query in both cases. Catalog coverage therefore limits which movies users can save.
- Use provider-backed autocomplete with a short debounce and reuse repeated query results. Only display results for the current query. Verify partial-title search, provider typo tolerance, and deployed response time before describing those capabilities. Use provider-supported fuzzy matching within today's scope.

## Variant A — fact generation and correctness

| Invariant | Observable behavior |
|---|---|
| Facts belong to an authenticated user and a specific film. | Derive the user ID from the server session for every read and write. Key fact history and generation coordination by user ID and catalog movie ID. The two versions of *Dune* have independent histories. Keep credentials server-side. |
| Freshness starts when a fact is successfully saved. | For age under 60 seconds, return the latest saved fact. At exactly 60 seconds it becomes eligible for replacement on request. Time passing while the dashboard is open enables the button and leaves the current text readable. |
| Concurrent requests share an attempt. | Use a Postgres transaction-scoped advisory lock per user and movie. Recheck freshness after acquiring it. Only one caller generates, including across server instances. Persist the fact and make it available to all waiting callers on success. |
| Retries are deliberate. | Record when an attempt failed so a caller already waiting receives the shared failure outcome. Commit that failure state before releasing the lock. A later explicit retry can start immediately. Failure leaves the last successful timestamp intact. |
| A refresh preserves reading progress. | While loading another fact for the same film, keep the previous text visible with a small progress indicator. On timeout, error, or model abstention, return the latest saved fact for that user and movie when available and disclose the failed refresh. With no fallback, show a clear retryable error. |
| Facts are safe to read before watching. | Instruct the model to avoid spoilers, including production anecdotes that reveal twists. Include the selected film's identity and previous fact in the prompt. Ask for a different detail to reduce consecutive repeats. Allow abstention when confidence is low. Persist only successful facts. |

Give each OpenAI attempt an eight-second timeout. Holding a database connection during generation is the accepted cost of the simpler lock design. Configure the transaction to allow for lock waiting and the bounded generation call. Spoiler avoidance and variety require sample review as well as checking the prompt.

**Gate before B.** Verify isolation across users and films, cache reuse at 59 seconds and eligibility at 60, simultaneous successful requests producing one stored fact, and simultaneous failed requests producing one attempt. Exercise failure both with and without a saved fallback. Confirm a deliberate retry can start immediately and a failed attempt never advances freshness.

## Variant B — dashboard and typed API

- Provide typed operations for profile retrieval, favorite updates, and fact retrieval through a shared client. Normalize errors as `{ error: { code, message } }`. A fallback response must let the client distinguish a failed refresh from an ordinary cache hit.
- Reuse the client fact cache for up to 30 seconds within the current user and movie context. An explicit new-fact request skips that cache and still respects the server's 60-second rule. Drive button availability from the saved fact's timestamp. Switching movies invalidates the browser result. Switching back can reuse a still-fresh server fact without resetting its age.
- Editing leaves the current movie and fact readable. Cancel discards the draft. Save optimistically displays the selected movie and immediately hides the old movie's fact. Start its fact request after save confirmation. Ignore late responses for a different movie.
- On save failure, restore the confirmed movie and its fact together. Keep the editor open with the search text and selected film intact. Offer Try again and Cancel.
- Across tabs, the last successful save wins. Preserve each tab's unsaved draft. If a tab learns about a conflicting successful save, show the newly saved title beside the draft so the user can deliberately replace it. Cancel returns to the latest confirmed favorite. Real-time notification delivery is optional polish.

**Acceptance checks.** Exercise client handling of authorization and server errors, Save and Cancel, optimistic rollback with draft retention, stale responses after a movie switch, and client-cache reuse and invalidation. Confirm an older search response cannot replace results for a newer query.

## Scope for this submission

Prioritize authorization, Variant A correctness, and the required Variant B flows. Use catalog search and title/year cards for disambiguation. Keep custom fuzzy matching or machine learning, movie clips or verified scene matching, and checkable sources for every fact as stretch goals. Before relying on TMDB in deployment, verify credentials, attribution requirements, and search behavior.
