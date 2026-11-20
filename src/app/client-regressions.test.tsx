// @vitest-environment happy-dom

import { act, type ReactNode, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MovieSummary } from "@/components/types";
import { api } from "@/lib/api";
import { DashboardFact } from "./dashboard/dashboard-fact";
import { Explorer } from "./dashboard/explorer";
import { OnboardingSearch } from "./onboarding/onboarding-search";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const dune: MovieSummary = { tmdbId: 438631, title: "Dune", releaseYear: 2021, posterUrl: null };
const arrival: MovieSummary = {
  tmdbId: 329865,
  title: "Arrival",
  releaseYear: 2016,
  posterUrl: null,
};
const replacement: MovieSummary = {
  tmdbId: 152601,
  title: "Her",
  releaseYear: 2013,
  posterUrl: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(view: ReactNode) {
  await act(async () => root.render(view));
}

function element<T extends Element>(selector: string) {
  const match = container.querySelector<T>(selector);
  if (!match) throw new Error(`Missing element: ${selector}`);
  return match;
}

function button(label: string, scope: ParentNode = container) {
  const match = [...scope.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function searchForDune() {
  const input = element<HTMLInputElement>("input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Missing input value setter");
  await act(async () => {
    setter.call(input, dune.title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("onboarding in Strict Mode", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "searchMovies").mockResolvedValue({ ok: true, data: { movies: [dune] } });
    vi.spyOn(api, "setFavoriteMovie").mockResolvedValue({ ok: true, data: { movie: dune } });
    await render(
      <StrictMode>
        <OnboardingSearch />
      </StrictMode>,
    );
    await searchForDune();
  });

  it("saves a clicked result and opens the dashboard after the effect replays", async () => {
    await act(async () => vi.advanceTimersByTimeAsync(250));
    const result = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes(dune.title),
    );
    if (!result) throw new Error("Missing Dune search result");
    await act(async () => result.click());

    expect(api.setFavoriteMovie).toHaveBeenCalledExactlyOnceWith(dune.tmdbId);
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("saves an exact match when Enter submits the form after the effect replays", async () => {
    await act(async () => {
      element<HTMLFormElement>("form").requestSubmit();
    });

    expect(api.setFavoriteMovie).toHaveBeenCalledExactlyOnceWith(dune.tmdbId);
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });
});

function fact(ageSeconds: number, text: string) {
  return {
    ok: true,
    data: {
      source: "cached",
      fact: { id: "fact-id", text, ageSeconds, generatedAt: new Date().toISOString() },
    },
  } as const;
}

it("opens sign-in when a refresh of a displayed fact returns 401", async () => {
  vi.useFakeTimers();
  const signInMessage = "Sign in to continue.";
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const loadFact = vi
    .spyOn(api, "getFact")
    .mockResolvedValueOnce(fact(65, "The displayed fact."))
    .mockResolvedValueOnce({
      ok: false,
      error: { status: 401, code: "unauthorized", message: signInMessage },
    });

  await render(<DashboardFact userId="user" movieId={dune.tmdbId} />);
  expect(container.textContent).toContain("The displayed fact.");
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(button("New fact").disabled).toBe(false);

  await act(async () => button("New fact").click());

  expect(loadFact).toHaveBeenCalledTimes(2);
  expect(assign).toHaveBeenCalledExactlyOnceWith("/");
  expect(container.textContent).not.toContain(signInMessage);
  expect(container.textContent).not.toContain("Retry");
});

it("disables all graph controls during a favorite save and restores the selected movie and fact on rollback", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  vi.spyOn(api, "getCast").mockResolvedValue({
    ok: true,
    data: { cast: [{ personId: 1, name: "Actor", character: null, profileUrl: null }] },
  });
  const getFilms = vi
    .spyOn(api, "getLeadingFilms")
    .mockResolvedValue({ ok: true, data: { films: [arrival] } });
  const duneFact = "The Dune fact.";
  const arrivalFact = "The Arrival fact.";
  const loadFact = vi
    .spyOn(api, "getFact")
    .mockImplementation(async (id) => fact(0, id === arrival.tmdbId ? arrivalFact : duneFact));

  const explorer = (pending: MovieSummary | null) => (
    <Explorer userId="user" root={dune} pending={pending} />
  );
  await render(explorer(null));
  await act(async () => element<HTMLButtonElement>("[data-key^='junction|']").click());
  await act(async () => element<HTMLButtonElement>(`[data-key='node|${arrival.tmdbId}']`).click());
  expect(element("h1").textContent).toBe(arrival.title);
  expect(container.textContent).toContain(arrivalFact);
  expect(container.textContent).not.toContain(duneFact);

  await render(explorer(replacement));
  expect(element("h1").textContent).toBe(replacement.title);
  const controls = [
    ...element("[aria-label='Movie graph']").querySelectorAll("button"),
    button("Back to favorite"),
    button(dune.title, element("[aria-label='Path from your favorite']")),
  ];
  expect(controls.length).toBeGreaterThanOrEqual(6);
  for (const control of controls) {
    expect(control.disabled).toBe(true);
    await act(async () => control.click());
  }
  expect(getFilms).toHaveBeenCalledOnce();

  await render(explorer(null));
  expect(element("h1").textContent).toBe(arrival.title);
  expect(container.textContent).toContain(arrivalFact);
  expect(container.textContent).not.toContain(duneFact);
  expect(loadFact).toHaveBeenCalledTimes(2);
  expect(controls.every((control) => !control.disabled)).toBe(true);

  await act(async () => button("Back to favorite").click());
  expect(element("h1").textContent).toBe(dune.title);
});
