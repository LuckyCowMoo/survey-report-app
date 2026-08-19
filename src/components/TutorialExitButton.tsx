import { createPortal } from "react-dom";
import { useT } from "../lib/i18n";

type Props = {
  onExit: () => void;
};

export default function TutorialExitButton({ onExit }: Props) {
  const t = useT();
  return createPortal(
    <button
      type="button"
      className="tutorial-exit-btn"
      onClick={onExit}
    >
      {t("tutorial.exit")}
    </button>,
    document.body
  );
}
