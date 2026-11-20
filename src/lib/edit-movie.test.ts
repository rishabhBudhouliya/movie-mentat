import { describe, expect, it } from "vitest";
import type { MovieSummary } from "@/components/types";
import {
  displayedMovie,
  initialMovieState,
  type MovieEvent,
  type MovieState,
  reduce,
} from "./edit-movie";

const movie = (tmdbId: number, title: string): MovieSummary => ({
  tmdbId,
  title,
  releaseYear: 2000,
  posterUrl: null,
});
const beginners = movie(55347, "Beginners");
const dune = movie(438631, "Dune");
const arrival = movie(329865, "Arrival");

const run = (state: MovieState, ...events: MovieEvent[]) => events.reduce(reduce, state);
const start = initialMovieState(beginners);
const pickDune: MovieEvent = { type: "draftChanged", draft: { query: "dune", selected: dune } };

describe("inline movie edit flow", () => {
  it("Cancel discards the draft and shows the confirmed movie", () => {
    const state = run(start, { type: "edit" }, pickDune, { type: "cancel" });

    expect(state).toEqual(start);
    expect(displayedMovie(state)).toBe(beginners);
  });

  it("Save is optimistic: the selected movie shows before the server confirms", () => {
    const saving = run(start, { type: "edit" }, pickDune, { type: "save" });

    expect(saving.view.kind).toBe("saving");
    expect(displayedMovie(saving)).toBe(dune);
    expect(saving.confirmed).toBe(beginners); // still the rollback target
  });

  it("a confirmed save becomes the new favorite", () => {
    const state = run(
      start,
      { type: "edit" },
      pickDune,
      { type: "save" },
      { type: "saveSucceeded", movie: dune },
    );

    expect(state).toEqual(initialMovieState(dune));
  });

  it("a failed save rolls back, keeping the editor open with the draft intact", () => {
    const state = run(
      start,
      { type: "edit" },
      pickDune,
      { type: "save" },
      { type: "saveFailed", message: "Network down" },
    );

    expect(displayedMovie(state)).toBe(beginners);
    expect(state.view).toEqual({
      kind: "editing",
      draft: { query: "dune", selected: dune },
      error: "Network down",
    });
  });

  it("Try again after a failure re-saves the retained draft", () => {
    const failed = run(
      start,
      { type: "edit" },
      pickDune,
      { type: "save" },
      { type: "saveFailed", message: "x" },
    );

    const retried = reduce(failed, { type: "save" });

    expect(retried.view).toMatchObject({ kind: "saving", draft: { selected: dune } });
  });

  it("Save without a selection, or with the same movie, changes nothing on the server", () => {
    const noPick = run(start, { type: "edit" }, { type: "save" });
    expect(noPick.view.kind).toBe("editing");

    const same = run(
      start,
      { type: "edit" },
      { type: "draftChanged", draft: { query: "b", selected: beginners } },
      { type: "save" },
    );
    expect(same).toEqual(start);
  });

  it("ignores events that don't apply in the current state", () => {
    expect(reduce(start, { type: "save" })).toBe(start);
    expect(reduce(start, { type: "cancel" })).toBe(start);
    expect(reduce(start, { type: "saveSucceeded", movie: dune })).toBe(start);
    expect(reduce(start, { type: "saveFailed", message: "x" })).toBe(start);
    expect(reduce(start, pickDune)).toBe(start);
    const editing = reduce(start, { type: "edit" });
    expect(reduce(editing, { type: "edit" })).toBe(editing);
  });
});

describe("across tabs: the last successful save wins", () => {
  it("while viewing, adopts the movie saved in another tab", () => {
    const state = reduce(start, { type: "serverChanged", movie: arrival });

    expect(state.confirmed).toBe(arrival);
    expect(state.conflict).toBeNull();
  });

  it("while editing, keeps the draft and shows the other tab's save beside it", () => {
    const state = run(start, { type: "edit" }, pickDune, { type: "serverChanged", movie: arrival });

    expect(state.view).toMatchObject({ kind: "editing", draft: { selected: dune } });
    expect(state.conflict).toBe(arrival);
    // Cancel returns to the latest confirmed favorite, which is now Arrival.
    expect(displayedMovie(reduce(state, { type: "cancel" }))).toBe(arrival);
  });

  it("the user can still deliberately save the draft over it", () => {
    const state = run(
      start,
      { type: "edit" },
      pickDune,
      { type: "serverChanged", movie: arrival },
      { type: "save" },
      { type: "saveSucceeded", movie: dune },
    );

    expect(state).toEqual(initialMovieState(dune));
  });

  it("ignores no-op updates and updates during this tab's own save", () => {
    expect(reduce(start, { type: "serverChanged", movie: beginners })).toBe(start);
    const saving = run(start, { type: "edit" }, pickDune, { type: "save" });
    expect(reduce(saving, { type: "serverChanged", movie: arrival })).toBe(saving);
  });
});
