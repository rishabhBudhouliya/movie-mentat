import type { MovieSummary } from "@/components/types";

// Variant B inline editing as one pure reducer (Elm architecture): every
// transition is a function of (state, event), so the edit-flow rules from
// PRODUCT_DECISIONS.md are tested without a browser.

export type Draft = { query: string; selected: MovieSummary | null };

export type EditView =
  | { kind: "viewing" }
  | { kind: "editing"; draft: Draft; error: string | null }
  | { kind: "saving"; draft: Draft & { selected: MovieSummary } };

export type MovieState = {
  /** The last save this tab knows succeeded: the source of truth to roll back to. */
  confirmed: MovieSummary;
  view: EditView;
  /** A save from another tab, learned while this tab had an unsaved draft. */
  conflict: MovieSummary | null;
};

export type MovieEvent =
  | { type: "edit" }
  | { type: "draftChanged"; draft: Draft }
  | { type: "cancel" }
  | { type: "save" }
  | { type: "saveSucceeded"; movie: MovieSummary }
  | { type: "saveFailed"; message: string }
  /** The server's current favorite, from GET /api/me (e.g. on tab focus). */
  | { type: "serverChanged"; movie: MovieSummary };

export function initialMovieState(confirmed: MovieSummary): MovieState {
  return { confirmed, view: { kind: "viewing" }, conflict: null };
}

/** What the card shows: the optimistic choice while saving, else the confirmed one. */
export function displayedMovie(state: MovieState): MovieSummary {
  return state.view.kind === "saving" ? state.view.draft.selected : state.confirmed;
}

const emptyDraft: Draft = { query: "", selected: null };

export function reduce(state: MovieState, event: MovieEvent): MovieState {
  const { view } = state;
  switch (event.type) {
    case "edit":
      return view.kind === "viewing"
        ? { ...state, view: { kind: "editing", draft: emptyDraft, error: null } }
        : state;

    case "draftChanged":
      return view.kind === "editing" ? { ...state, view: { ...view, draft: event.draft } } : state;

    case "cancel":
      // Discards the draft; the card returns to the latest confirmed favorite.
      return view.kind === "editing"
        ? { ...state, view: { kind: "viewing" }, conflict: null }
        : state;

    case "save": {
      if (view.kind !== "editing") return state;
      const { selected } = view.draft;
      if (selected === null) return state; // nothing chosen yet
      if (selected.tmdbId === state.confirmed.tmdbId) {
        return { ...state, view: { kind: "viewing" }, conflict: null }; // no change to save
      }
      return { ...state, view: { kind: "saving", draft: { ...view.draft, selected } } };
    }

    case "saveSucceeded":
      return view.kind === "saving" ? initialMovieState(event.movie) : state;

    case "saveFailed":
      // Roll back to the confirmed movie, but keep the editor open with the
      // search text and selection intact so "Try again" is one click.
      return view.kind === "saving"
        ? { ...state, view: { kind: "editing", draft: view.draft, error: event.message } }
        : state;

    case "serverChanged": {
      if (event.movie.tmdbId === state.confirmed.tmdbId) return state;
      switch (view.kind) {
        case "viewing": // last successful save wins
          return { ...state, confirmed: event.movie };
        case "editing": // keep the draft; show what was saved elsewhere beside it
          return { ...state, confirmed: event.movie, conflict: event.movie };
        case "saving": // our own save is in flight and will settle this
          return state;
      }
    }
  }
}
