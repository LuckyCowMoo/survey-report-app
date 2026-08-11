export type AppStep = "home" | "review" | "details" | "generate";
export type AppOverlay = "settings" | "guide" | "library";

export type AppHistState = {
  app: 1;
  step: AppStep;
  overlay?: AppOverlay;
};

export function isAppHist(state: unknown): state is AppHistState {
  if (!state || typeof state !== "object") return false;
  const s = state as AppHistState;
  return s.app === 1 && typeof s.step === "string";
}

export function readAppHist(state: unknown): AppHistState {
  return isAppHist(state) ? state : { app: 1, step: "home" };
}

export function currentAppHist(): AppHistState {
  return readAppHist(history.state);
}

export function replaceAppHist(next: AppHistState) {
  history.replaceState(next, "");
}

export function pushAppHist(next: AppHistState) {
  history.pushState(next, "");
}

/** Close a history-backed overlay; falls back to `fallback` when not in stack. */
export function dismissAppOverlay(overlay: AppOverlay, fallback: () => void) {
  if (currentAppHist().overlay === overlay) history.back();
  else fallback();
}
