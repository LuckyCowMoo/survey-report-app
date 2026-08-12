/**
 * On coarse/mobile devices, lock portrait when landscape height would be too short.
 * Uses the Screen Orientation API when available (installed PWA / supported browsers);
 * otherwise shows a rotate-back overlay via a CSS class on <html>.
 */

const MIN_LANDSCAPE_HEIGHT_PX = 480;

function isMobileLike(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches
  );
}

function landscapeHeightWouldBe(): number {
  // After rotating to landscape, height ≈ the shorter screen edge.
  return Math.min(window.screen.width, window.screen.height);
}

function shouldLockPortrait(): boolean {
  return isMobileLike() && landscapeHeightWouldBe() < MIN_LANDSCAPE_HEIGHT_PX;
}

async function tryLockPortrait(): Promise<boolean> {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (type: string) => Promise<void>;
    unlock?: () => void;
  };
  if (!orientation?.lock) return false;
  try {
    await orientation.lock("portrait");
    return true;
  } catch {
    try {
      await orientation.lock("portrait-primary");
      return true;
    } catch {
      return false;
    }
  }
}

function tryUnlock(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Ignore — unlock is best-effort.
  }
}

function syncLandscapeBlockClass(): void {
  const block =
    shouldLockPortrait() &&
    window.matchMedia("(orientation: landscape)").matches;
  document.documentElement.classList.toggle("orientation-block-landscape", block);
}

/**
 * Call once from the app root. Keeps portrait locked when landscape would be
 * too short, and toggles a fallback overlay class if lock isn’t available.
 */
export function startOrientationGuard(): () => void {
  let cancelled = false;

  const apply = () => {
    if (cancelled) return;
    if (shouldLockPortrait()) {
      void tryLockPortrait();
    } else {
      tryUnlock();
    }
    syncLandscapeBlockClass();
  };

  apply();

  const onChange = () => apply();
  window.addEventListener("orientationchange", onChange);
  window.addEventListener("resize", onChange);
  screen.orientation?.addEventListener?.("change", onChange);

  const mq = window.matchMedia("(orientation: landscape)");
  mq.addEventListener?.("change", onChange);

  return () => {
    cancelled = true;
    window.removeEventListener("orientationchange", onChange);
    window.removeEventListener("resize", onChange);
    screen.orientation?.removeEventListener?.("change", onChange);
    mq.removeEventListener?.("change", onChange);
    tryUnlock();
    document.documentElement.classList.remove("orientation-block-landscape");
  };
}
