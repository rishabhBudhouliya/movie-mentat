// One color per billing slot, so a direction keeps its color everywhere it
// appears (graph, "Go deeper via" list). They differ in lightness as well as
// hue, and each actor is always labeled by name, so color is never the only cue.
const DIRECTION_COLORS = ["#4f9dff", "#ff9a6b", "#9ee6c9"] as const;

export function directionColor(slot: number): string {
  return DIRECTION_COLORS[slot % DIRECTION_COLORS.length] ?? DIRECTION_COLORS[0];
}
