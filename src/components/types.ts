export type MovieSummary = {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  posterUrl: string | null;
};

export type SearchState =
  | { kind: "idle" } // nothing typed yet
  | { kind: "loading" }
  | { kind: "results"; movies: MovieSummary[] } // 1+ results
  | { kind: "ambiguous"; candidates: [MovieSummary, MovieSummary] } // show 2 best as selectable cards + "edit search"
  | { kind: "empty" } // copy must be exactly: "No match found. Try another title or add a release year."
  | { kind: "error"; message: string }; // catalog unavailable → message + Retry button

export type FactState =
  | { kind: "loading" } // first load, nothing to show yet
  | { kind: "fact"; text: string; generatedAt: string; refreshing: boolean } // refreshing: keep text visible + small progress indicator
  | { kind: "fallback"; text: string; generatedAt: string; notice: string } // refresh failed; show saved fact + disclose failure
  | { kind: "error"; message: string }; // nothing saved; clear retryable error
