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
  shotCount: number;
  retake: boolean;
  retakeIndex: number;
  onCanCaptureChange: (ok: boolean) => void;
};

const TutorialLiveView = forwardRef<TutorialLiveHandle, Props>(
  function TutorialLiveView(
    { shotCount, retake, retakeIndex, onCanCaptureChange },
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

    useEffect(() => {
      if (!spawnPano) return;
      if (retake) {
        walkDoneRef.current = true;
        const gutter = retakeIndex >= 1;
        setPanoKind(gutter ? "gutter" : "spawn");
        setLocked(false);
        setWalkMode("off");
        setPhase(gutter ? "shot2" : "shot1");
        const look = gutter ? TUTORIAL_LOOK.gutter : TUTORIAL_LOOK.spawn;
        requestAnimationFrame(() => {
          viewRef.current?.setLook(look.yaw, look.pitch);
          viewRef.current?.setLocked(false);
          viewRef.current?.recalibrate();
        });
        return;
      }
      if (shotCount <= 0) {
        walkDoneRef.current = false;
        setPanoKind("spawn");
        setLocked(false);
        setWalkMode("off");
        setPhase("shot1");
        requestAnimationFrame(() => {
          viewRef.current?.setLook(
            TUTORIAL_LOOK.spawn.yaw,
            TUTORIAL_LOOK.spawn.pitch
          );
          viewRef.current?.setLocked(false);
          viewRef.current?.recalibrate();
        });
        return;
      }
      if (shotCount === 1 && !walkDoneRef.current) {
        setPanoKind("spawn");
        setLocked(false);
        setWalkMode("off");
        setPhase("shot2-hold");
        requestAnimationFrame(() => {
          viewRef.current?.setLook(
            TUTORIAL_LOOK.spawn.yaw,
            TUTORIAL_LOOK.spawn.pitch
          );
          viewRef.current?.setLocked(false);
          viewRef.current?.recalibrate();
        });
        return;
      }
      setPanoKind("gutter");
      setLocked(false);
      setWalkMode("off");
      setPhase(shotCount <= 1 ? "shot2" : "free");
      requestAnimationFrame(() => {
        viewRef.current?.setLook(
          TUTORIAL_LOOK.gutter.yaw,
          TUTORIAL_LOOK.gutter.pitch
        );
        viewRef.current?.setLocked(false);
        viewRef.current?.recalibrate();
      });
    }, [retake, retakeIndex, shotCount, spawnPano]);

    useEffect(() => {
      if (phase !== "shot2-hold" || retake) return;
      const timer = window.setTimeout(() => {
        setPhase("shot2-slew");
      }, TUTORIAL_TIMING.shot2HoldMs);
      return () => window.clearTimeout(timer);
    }, [phase, retake]);

    useEffect(() => {
      if (phase !== "shot2-slew") return;
      let cancelled = false;
      setLocked(true);
      viewRef.current?.setLocked(true);
      void (async () => {
        await viewRef.current?.animateTo(
          TUTORIAL_LOOK.walkAlign.yaw,
          TUTORIAL_LOOK.walkAlign.pitch,
          TUTORIAL_TIMING.slewMs
        );
        if (cancelled) return;
        const video = videoRef.current;
        if (video) {
          try {
            video.load();
            await video.play();
            if (cancelled) return;
            setWalkMode("video");
            setPhase("shot2-walk");
            return;
          } catch {
            /* fall through to the stills walk */
          }
        }
        setFallbackT(0);
        setWalkMode("fallback");
        setPhase("shot2-walk");
      })();
      return () => {
        cancelled = true;
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
      walkDoneRef.current = true;
      setWalkMode("off");
      setPanoKind("gutter");
      setPhase("shot2");
      setLocked(false);
      requestAnimationFrame(() => {
        viewRef.current?.setLook(
          TUTORIAL_LOOK.gutter.yaw,
          TUTORIAL_LOOK.gutter.pitch
        );
        viewRef.current?.setLocked(false);
        viewRef.current?.recalibrate();
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

    const hint = tutorialHint(shotCount, phase);

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

        <div className="tutorial-aim-frame" data-ok={aligned && walkMode === "off"} />

        <p className="tutorial-build-stamp">test cam 360</p>
        <div className="tutorial-live-hud">
          <p className="tutorial-live-hint">{hint}</p>
          {needGyroTap && !locked && (
            <button
              type="button"
              className="btn small tutorial-gyro-btn"
              onClick={() => void enableGyro()}
            >
              {hasGyro ? "Motion on" : "Look by turning the phone"}
            </button>
          )}
          {!needGyroTap && walkMode === "off" && !locked && (
            <p className="tutorial-live-sub">
              Drag to look · turn the phone if motion is allowed
            </p>
          )}
        </div>
      </div>
    );
  }
);

export default TutorialLiveView;
