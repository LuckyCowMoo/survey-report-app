import { useEffect, useRef, useState } from "react";
import HomeCtaMorph from "./HomeCtaMorph";
import { IconCamera, IconFileUp } from "./icons";
import TutorialCoach from "./TutorialCoach";
import { coachFor, type TutorialBeat } from "../lib/tutorial/flow";

type Props = {
  beat: TutorialBeat;
  onNewReport: () => void;
  onCreateFieldNotes: () => void;
};

export default function TutorialHomeIntro({
  beat,
  onNewReport,
  onCreateFieldNotes
}: Props) {
  const splitRootRef = useRef<HTMLDivElement>(null);
  const [ctaSplit, setCtaSplit] = useState(beat === "createFieldNotes");
  const [ctaMerging, setCtaMerging] = useState(false);
  const splitLive = ctaSplit && !ctaMerging;
  const spec = coachFor(beat);
  const createOnly = beat === "createFieldNotes";

  useEffect(() => {
    if (beat === "createFieldNotes") {
      setCtaSplit(true);
      setCtaMerging(false);
    }
  }, [beat]);

  const openSplit = () => {
    if (ctaSplit || ctaMerging) return;
    setCtaSplit(true);
    onNewReport();
  };

  return (
    <div className={`tutorial-home-intro${createOnly ? " is-split-copy" : ""}`}>
      {spec ? <TutorialCoach spec={spec} /> : null}
      <div
        ref={splitRootRef}
        className={`home-cta-split${ctaSplit ? " is-split" : ""}${
          ctaMerging ? " is-merging" : ""
        }`}
      >
        <HomeCtaMorph
          split={ctaSplit}
          merging={ctaMerging}
          radius={24}
          gap={14}
          blob="#151515"
          importFill="#ff5a36"
          createFill="#00e3d4"
        />

        <button
          type="button"
          className="home-cta-merged"
          tabIndex={splitLive ? -1 : 0}
          aria-hidden={splitLive}
          aria-expanded={ctaSplit}
          onClick={openSplit}
        >
          <span className="home-btn-label">
            <span className="home-btn-title">Start new report</span>
            <span className="home-upload-meta">Import or create</span>
          </span>
        </button>

        <div className="home-cta-pair" role="group" aria-label="Start new report">
          <button
            type="button"
            className="home-cta-half home-cta-import"
            tabIndex={splitLive ? 0 : -1}
            onClick={() => {
              /* tutorial: import is explained but does nothing */
            }}
          >
            <span className="home-cta-glyph" aria-hidden>
              <IconFileUp className="home-cta-glyph-svg" />
            </span>
            <span className="home-cta-copy">
              <span className="home-btn-title">Import field notes</span>
              <span className="home-upload-meta">.DOCX ↗</span>
            </span>
          </button>
          <button
            type="button"
            className="home-cta-half home-cta-create"
            tabIndex={splitLive ? 0 : -1}
            onClick={() => {
              if (beat !== "createFieldNotes") return;
              setCtaSplit(false);
              setCtaMerging(false);
              onCreateFieldNotes();
            }}
          >
            <span className="home-cta-glyph" aria-hidden>
              <IconCamera className="home-cta-glyph-svg" />
            </span>
            <span className="home-cta-copy">
              <span className="home-btn-title">Create new field notes</span>
              <span className="home-upload-meta">Camera</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
