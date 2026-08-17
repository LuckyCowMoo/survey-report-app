import {
  getScrollRoot,
  markProgrammaticScroll,
  readScrollTop,
  writeScrollTop
} from "./scrollRoot";

/** Hold still this long to pick up a review section for reordering. */
export const SECTION_LIFT_HOLD_MS = 2000;
export const SECTION_LIFT_MOVE_SLOP_PX = 12;
export const SECTION_LIFT_EDGE_PX = 72;
export const SECTION_LIFT_SCROLL_PX = 7;

const INTERACTIVE_SELECTOR =
  "button,a,input,textarea,select,label,[role='button'],[contenteditable='true']";

export function isLiftInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(INTERACTIVE_SELECTOR));
}

/**
 * Move `from` → `to` where `to` is the destination index in the array
 * *after* the item has been removed (0 … length-1).
 */
export function reorderArray<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  const clamped = Math.max(0, Math.min(next.length, to));
  if (clamped === from) {
    // Same place after removal accounting — still fine to splice back
  }
  next.splice(clamped, 0, item);
  return next;
}

/**
 * Pointer Y → insert slot among the other cards (source excluded).
 * Returns 0…others.length for use as `to` in reorderArray after removal.
 */
export function insertSlotFromPointerY(
  clientY: number,
  otherMids: number[]
): number {
  for (let i = 0; i < otherMids.length; i++) {
    if (clientY < otherMids[i]!) return i;
  }
  return otherMids.length;
}

/**
 * Convert “slot among others” to the `to` index for reorderArray.
 * `otherMids` were measured in original list order excluding `from`.
 * Slot is how many of those others should stay above the dragged item.
 * After removing `from`, that slot index is exactly `to`.
 */
export function slotToRemovalIndex(_from: number, slot: number): number {
  return slot;
}

export function scrollRootViewport(): {
  top: number;
  bottom: number;
  height: number;
} {
  const root = getScrollRoot();
  if (root instanceof Window) {
    return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  }
  const r = root.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, height: r.height };
}

/** Nudge scroll when pointer is near the top/bottom of the review scrollport. */
export function autoScrollForLift(clientY: number): boolean {
  const view = scrollRootViewport();
  const root = getScrollRoot();
  let delta = 0;
  if (clientY < view.top + SECTION_LIFT_EDGE_PX) {
    const t = 1 - (clientY - view.top) / SECTION_LIFT_EDGE_PX;
    delta =
      -SECTION_LIFT_SCROLL_PX *
      (0.35 + 0.65 * Math.min(1, Math.max(0, t)));
  } else if (clientY > view.bottom - SECTION_LIFT_EDGE_PX) {
    const t = 1 - (view.bottom - clientY) / SECTION_LIFT_EDGE_PX;
    delta =
      SECTION_LIFT_SCROLL_PX * (0.35 + 0.65 * Math.min(1, Math.max(0, t)));
  }
  if (delta === 0) return false;
  // Long enough that late Firefox scroll events still count as programmatic.
  markProgrammaticScroll(400);
  writeScrollTop(root, readScrollTop(root) + delta);
  return true;
}

/**
 * Firefox (touch) can break async pan/zoom after scrollTop changes during a
 * gesture. Nudge overflow so the scrollport accepts touch again.
 */
export function recoverScrollTouchAfterLift() {
  const root = getScrollRoot();
  if (root instanceof Window) {
    const y = window.scrollY;
    const html = document.documentElement;
    const prev = html.style.overflowY;
    html.style.overflowY = "hidden";
    void html.offsetHeight;
    html.style.overflowY = prev;
    window.scrollTo(0, y);
    return;
  }
  const y = root.scrollTop;
  const prevOverflow = root.style.overflowY;
  root.style.overflowY = "hidden";
  void root.offsetHeight;
  root.style.overflowY = prevOverflow;
  root.scrollTop = y;
}

const LIFT_LOCK_CLASS = "is-lift-scroll-lock";

let touchPanBlock: ((e: TouchEvent) => void) | null = null;

/** Apply immediately on pointerdown — touch-action/overflow mid-gesture is too late on Firefox. */
export function applyLiftScrollLock() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add(LIFT_LOCK_CLASS);
  const root = getScrollRoot();
  if (root instanceof HTMLElement) root.classList.add(LIFT_LOCK_CLASS);
  // Stop Chrome treating the hold/drag as a page scroll (that fires pointercancel
  // and used to drop the tile, or lock the UI if pointerup was ignored).
  if (!touchPanBlock) {
    touchPanBlock = (e) => e.preventDefault();
    window.addEventListener("touchmove", touchPanBlock, {
      passive: false,
      capture: true
    });
  }
}

export function clearLiftScrollLock() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove(LIFT_LOCK_CLASS);
  const root = getScrollRoot();
  if (root instanceof HTMLElement) root.classList.remove(LIFT_LOCK_CLASS);
  if (touchPanBlock) {
    window.removeEventListener("touchmove", touchPanBlock, true);
    touchPanBlock = null;
  }
}

/** Keep scroll pinned unless edge auto-scroll moved it this frame. */
export function clampLiftScroll(lockedTop: number): number {
  const root = getScrollRoot();
  const current = readScrollTop(root);
  if (Math.abs(current - lockedTop) < 0.5) return lockedTop;
  markProgrammaticScroll(400);
  writeScrollTop(root, lockedTop);
  return lockedTop;
}
