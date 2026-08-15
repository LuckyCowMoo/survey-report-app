import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import EquirectViewfinder, {
  type EquirectHandle
} from "./EquirectViewfinder";
import { loadTutorialPano } from "../lib/tutorial/composePano";
import {
  looksAligned,
  TUTORIAL_ASSETS,
  TUTORIAL_LOOK,
  TUTORIAL_TIMING,
  tutorialHint,
  type TutorialPhase
} from "../lib/tutorial/script";
import {
  orientationNeedsPermission,
  requestOrientationPermission
} from "../lib/tutorial/orientation";

export type TutorialLiveHandle = {
  captureJpeg: () => Promise<Uint8Array>;
};

type Props = {
  chapter: "spawn" | "gutter";
  walkToken: number;
  freezeLook?: boolean;
  onWalkFinished?: () => void;
  hideChrome?: boolean;
  onCanCaptureChange: (ok: boolean) => void;
};

const TutorialLiveView = forwardRef<TutorialLiveHandle, Props>(
  function TutorialLiveView(
    { chapter, walkToken, freezeLook = false, onWalkFinished, hideChrome, onCanCaptureChange },
    ref
  ) {
    const viewRef = useRef<EquirectHandle>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const walkDoneRef = useRef(false);
    const [phase, setPhase] = useState<TutorialPhase>("loading");
    const [spawnPano, setSpawnPano] = useState<HTMLImageElement | null>(null);
    const [gutterPano, setGutterPano] = useState<HTMLImageElement | null>(
      null
    );
    const [panoKind, setPanoKind] = useState<"spawn" | "gutter">("spawn");
    const [locked, setLocked] = useState(false);
    const [hasGyro, setHasGyro] = useState(false);
    const [needGyroTap, setNeedGyroTap] = useState(false);
    const [aligned, setAligned] = useState(false);
    const [walkMode, setWalkMode] = useState<"off" | "video" | "fallback">(
      "off"
    );
    const [fallbackT, setFallbackT] = useState(0);

    const pano = panoKind === "gutter" ? gutterPano : spawnPano;
    const aim =
      panoKind === "gutter" ? TUTORIAL_LOOK.gutter : TUTORIAL_LOOK.front;

    useImperativeHandle(ref, () => ({
      captureJpeg: async () => {
        const v = viewRef.current;
        if (!v) throw new Error("Viewfinder is not ready yet.");
        return v.captureJpeg();
      }
    }));

    useEffect(() => {
      let cancelled = false;
      void (async () => {
        try {
          const [spawn, gutter] = await Promise.all([
            loadTutorialPano("spawn"),
            loadTutorialPano("gutter")
          ]);
          if (cancelled) return;
          setSpawnPano(spawn);
          setGutterPano(gutter);
        } catch {
          /* viewfinder stays empty until a retry / reload */
        }
      })();
      setNeedGyroTap(orientationNeedsPermission());
      return () => {
        cancelled = true;
      };
    }, []);

    const onWalkFinishedRef = useRef(onWalkFinished);
    onWalkFinishedRef.current = onWalkFinished;
    const lastWalkRef = useRef(0);

    useEffect(() => {
      if (!spawnPano) return;
      if (walkToken > lastWalkRef.current) return;
      setPanoKind(chapter);
      setLocked(freezeLook);
      setWalkMode("off");
      setPhase(chapter === "gutter" ? "shot2" : "shot1");
      const look =
        chapter === "gutter" ? TUTORIAL_LOOK.gutter : TUTORIAL_LOOK.front;
      requestAnimationFrame(() => {
        viewRef.current?.setLook(look.yaw, look.pitch);
        viewRef.current?.setLocked(freezeLook);
        viewRef.current?.recalibrate();
      });
    }, [chapter, spawnPano, walkToken, freezeLook]);

    useEffect(() => {
      if (!spawnPano || walkToken <= 0 || freezeLook) return;
      if (walkToken === lastWalkRef.current) return;
      lastWalkRef.current = walkToken;
      walkDoneRef.current = false;
      setPanoKind("spawn");
      setPhase("shot2-hold");
      requestAnimationFrame(() => {
        viewRef.current?.setLook(
          TUTORIAL_LOOK.spawn.yaw,
          TUTORIAL_LOOK.spawn.pitch
        );
        viewRef.current?.setLocked(false);
        viewRef.current?.recalibrate();
      });
    }, [walkToken, spawnPano, freezeLook]);

    useEffect(() => {
      if (phase !== "shot2-hold") return;
      const timer = window.setTimeout(() => {
        setPhase("shot2-slew");
      }, TUTORIAL_TIMING.shot2HoldMs);
      return () => window.clearTimeout(timer);
    }, [phase]);

    useEffect(() => {
      if (phase !== "shot2-slew") return;
      let cancelled = false;
      setLocked(true);
      viewRef.current?.setLocked(true);
      const failSafe = window.setTimeout(() => {
        if (!cancelled) finishWalk();
      }, TUTORIAL_TIMING.walkMaxMs);
      void (async () => {
        await viewRef.current?.animateTo(
          TUTORIAL_LOOK.walkAlign.yaw,
          TUTORIAL_LOOK.walkAlign.pitch,
          TUTORIAL_TIMING.slewMs
        );
        if (cancelled) return;
        setPhase("shot2-walk");
        const video = videoRef.current;
        if (video) {
          try {
            video.currentTime = 0;
            const playing = video.play();
            setWalkMode("video");
            await playing;
            return;
          } catch {
            /* fall through to the stills walk */
          }
        }
        setFallbackT(0);
        setWalkMode("fallback");
      })();
      return () => {
        cancelled = true;
        window.clearTimeout(failSafe);
      };
    }, [phase]);

    useEffect(() => {
      if (phase !== "shot2-walk" || walkMode !== "fallback") return;
      const start = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / TUTORIAL_TIMING.fallbackWalkMs);
        setFallbackT(t);
        if (t < 1) raf = requestAnimationFrame(tick);
        else finishWalk();
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, walkMode]);

    const finishWalk = () => {
      if (walkDoneRef.current) return;
      walkDoneRef.current = true;
      setPanoKind("gutter");
      setPhase("shot2");
      requestAnimationFrame(() => {
        viewRef.current?.setLook(0, 0);
        window.setTimeout(() => {
          setWalkMode("off");
          setLocked(false);
          viewRef.current?.setLocked(false);
          viewRef.current?.recalibrate();
          onWalkFinishedRef.current?.();
        }, TUTORIAL_TIMING.walkFadeMs);
      });
    };

    const canCapture =
      (phase === "shot1" || phase === "shot2" || phase === "free") &&
      aligned &&
      !!pano &&
      walkMode === "off";

    useEffect(() => {
      onCanCaptureChange(canCapture);
    }, [canCapture, onCanCaptureChange]);

    const enableGyro = async () => {
      const ok = await requestOrientationPermission();
      setHasGyro(ok);
      setNeedGyroTap(false);
      viewRef.current?.recalibrate();
    };

    const hint = tutorialHint(chapter === "spawn" ? 0 : 1, phase);

    return (
      <div className="tutorial-live-view">
        <EquirectViewfinder
          ref={viewRef}
          pano={pano}
          locked={locked}
          className="tutorial-equirect"
          onLook={(look) => setAligned(looksAligned(look, aim))}
        />

        <video
          ref={videoRef}
          className={`tutorial-walk-video${walkMode === "video" ? " is-on" : ""}`}
          src={TUTORIAL_ASSETS.walkVideo}
          playsInline
          muted
          preload="auto"
          onEnded={finishWalk}
        />

        {walkMode === "fallback" && (
          <div className="tutorial-walk-fallback" aria-hidden>
            <img
              className="tutorial-walk-still"
              src={TUTORIAL_ASSETS.frontPhoto}
              alt=""
              style={{
                transform: `translate3d(${-fallbackT * 42}%, ${fallbackT * 6}%, 0) scale(${1 + fallbackT * 0.28})`,
                opacity: 1 - Math.max(0, fallbackT - 0.55) / 0.45
              }}
            />
            <img
              className="tutorial-walk-still tutorial-walk-still-b"
              src={TUTORIAL_ASSETS.gutterPhoto}
              alt=""
              style={{
                opacity: Math.max(0, fallbackT - 0.42) / 0.58,
                transform: `translate3d(${(1 - fallbackT) * 18}%, ${(1 - fallbackT) * 10}%, 0) scale(${1.08 - fallbackT * 0.08})`
              }}
            />
          </div>
        )}

        <div className="tutorial-aim-frame" data-ok={aligned && walkMode === "off"}>
          <div className="tutorial-live-hud">
            {!hideChrome && <p className="tutorial-live-hint">{hint}</p>}
            {needGyroTap && !locked && (
              <button
                type="button"
                className="btn small tutorial-gyro-btn"
                onClick={() => void enableGyro()}
              >
                {hasGyro ? "Motion on" : "Look by turning the phone"}
              </button>
            )}
            {!hideChrome && !needGyroTap && walkMode === "off" && !locked && (
              <p className="tutorial-live-sub">
                Drag to look · turn the phone if motion is allowed
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
);

export default TutorialLiveView;
