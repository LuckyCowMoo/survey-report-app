import {
  useCallback,
  useRef,
  useState,
  type AnimationEvent,
  type MouseEvent,
  type ReactNode
} from "react";

export type SheetExitApi = {
  exiting: boolean;
  requestClose: () => void;
};

type Props = {
  onClose: () => void;
  children: ReactNode | ((api: SheetExitApi) => ReactNode);
  /** Extra classes on the backdrop (e.g. guide-wording-backdrop). */
  backdropClassName?: string;
  /** Extra classes on the sheet panel. */
  sheetClassName?: string;
  /** When true, ignore backdrop / programmatic close requests. */
  disableClose?: boolean;
  role?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
};

/**
 * Bottom sheet + backdrop with matching enter/exit slide.
 * Call requestClose() instead of onClose so the exit animation can finish first.
 */
export default function SheetShell({
  onClose,
  children,
  backdropClassName = "",
  sheetClassName = "sheet",
  disableClose = false,
  role = "dialog",
  "aria-labelledby": ariaLabelledBy,
  "aria-label": ariaLabel
}: Props) {
  const [exiting, setExiting] = useState(false);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (disableClose || closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setExiting(true);
  }, [disableClose, onClose]);

  const onSheetAnimEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (!exiting) return;
    if (e.target !== e.currentTarget) return;
    onClose();
  };

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    requestClose();
  };

  const api: SheetExitApi = { exiting, requestClose };
  const body = typeof children === "function" ? children(api) : children;

  return (
    <div
      className={`sheet-backdrop${exiting ? " is-exiting" : ""}${backdropClassName ? ` ${backdropClassName}` : ""}`}
      onClick={onBackdropClick}
    >
      <div
        className={`${sheetClassName}${exiting ? " is-exiting" : ""}`}
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onSheetAnimEnd}
      >
        {body}
      </div>
    </div>
  );
}
