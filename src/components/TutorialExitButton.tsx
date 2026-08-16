import { createPortal } from "react-dom";

type Props = {
  onExit: () => void;
};

export default function TutorialExitButton({ onExit }: Props) {
  return createPortal(
    <button
      type="button"
      className="tutorial-exit-btn"
      onClick={onExit}
    >
      Exit tutorial
    </button>,
    document.body
  );
}
