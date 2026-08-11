import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeScreen from "./components/HomeScreen";
import ReviewScreen from "./components/ReviewScreen";
import DetailsScreen from "./components/DetailsScreen";
import GenerateScreen from "./components/GenerateScreen";
import SettingsSheet from "./components/SettingsSheet";
import KeywordGuide from "./components/KeywordGuide";
import IntroSplash, { useIntroSplash } from "./components/IntroSplash";
import AmbientGlow from "./components/AmbientGlow";
import StudioAside from "./components/StudioAside";
import { IconBack, IconSettings } from "./components/icons";
import { parseShorthandDocx } from "./lib/docxParser";
import { matchEntries } from "./lib/matcher";
import { resolveSectionWithAi } from "./lib/claude";
import { activeAi, loadSettings, saveSettings, type AppSettings } from "./lib/settings";
import { usePointerInputMode } from "./lib/pointerInput";
import {
  currentAppHist,
  pushAppHist,
  readAppHist,
  replaceAppHist,
  type AppStep
} from "./lib/appHistory";
import type { ReportExtras, ReportMetadata, SectionState } from "./types";

type Step = AppStep;

function defaultMetadata(settings: AppSettings): ReportMetadata {
  return {
    companyName: settings.companyName,
    website: settings.website,
    propertyAddress: "",
    clientName: "",
    propertyType: "mid-terrace dwelling",
    surveyDate: new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }),
    weatherDesc: "dry conditions",
    temperature: "",
    skyDesc: "intermittent cloud cover",
    contactName: "",
    phone: "",
    email: "",
    docId: ""
  };
}

const defaultExtras: ReportExtras = {
  dampIssues: {
    risingDamp: false,
    penetratingDamp: false,
    condensation: false,
    other: false
  },
  otherIssueText: "",
  recommendationIds: [],
  otherRecommendation: false,
  otherRecommendationText: "",
  projectPlanLines: "",
  costLines: [],
  otherCost: false,
  otherCostDescription: "",
  otherCostAmount: "",
  surveyDiscount: "",
  timeEstimate: "5-7 days"
};

export default function App() {
  usePointerInputMode();
  const { showIntro, dismissIntro } = useIntroSplash();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [focusedSectionIndex, setFocusedSectionIndex] = useState(0);
  /** Section the user has actively focused; dwell timer only runs for this. */
  const [reviewDwellIndex, setReviewDwellIndex] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("home");
  const [sections, setSections] = useState<SectionState[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<ReportMetadata>(() =>
    defaultMetadata(loadSettings())
  );
  const [extras, setExtras] = useState<ReportExtras>(defaultExtras);
  const [busy, setBusy] = useState<string | null>(null);
  const [busySectionIndex, setBusySectionIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiErrors, setAiErrors] = useState<Record<number, string>>({});
  const [aiBatchRunning, setAiBatchRunning] = useState(false);
  const aiBatchAbortRef = useRef<AbortController | null>(null);
  const importTriggerRef = useRef<(() => void) | null>(null);

  const flaggedCount = useMemo(
    () => sections.filter((s) => s.needsAttention).length,
    [sections]
  );

  const aiErrorSectionNums = useMemo(() => {
    const nums = new Set<number>();
    for (const key of Object.keys(aiErrors)) {
      const n = sections[Number(key)]?.entry.number;
      if (n != null) nums.add(n);
    }
    return nums;
  }, [aiErrors, sections]);

  const stepRef = useRef(step);
  stepRef.current = step;

  const navigateTo = useCallback((next: Step) => {
    setStep(next);
    pushAppHist({ app: 1, step: next });
  }, []);

  const openSettings = useCallback(() => {
    setShowSettings(true);
    pushAppHist({ app: 1, step: stepRef.current, overlay: "settings" });
  }, []);

  const openGuide = useCallback(() => {
    setShowGuide(true);
    pushAppHist({ app: 1, step: stepRef.current, overlay: "guide" });
  }, []);

  const dismissOverlay = useCallback(() => {
    if (currentAppHist().overlay) history.back();
    else {
      setShowSettings(false);
      setShowGuide(false);
    }
  }, []);

  const goBack = useCallback(() => {
    if (showSettings || showGuide || step !== "home") {
      history.back();
      return true;
    }
    return false;
  }, [showSettings, showGuide, step]);

  /** Same destinations as Continue, or Import on the home page. */
  const continueForward = useCallback(() => {
    if (step === "home") {
      if (busy !== null) return false;
      importTriggerRef.current?.();
      return Boolean(importTriggerRef.current);
    }
    if (step === "review" && sections.length > 0) {
      navigateTo("details");
      return true;
    }
    if (step === "details") {
      navigateTo("generate");
      return true;
    }
    return false;
  }, [step, sections.length, navigateTo, busy]);

  /**
   * Browser/mouse forward when the history stack allows it; otherwise advance
   * like Continue / Import. Home Import must stay synchronous (file-picker gesture).
   */
  const goForward = useCallback(() => {
    if (showSettings || showGuide || currentAppHist().overlay) return false;

    const nav = window.navigation as { canGoForward?: boolean } | undefined;
    if (nav?.canGoForward) {
      history.forward();
      return true;
    }

    // No forward history — Import on home, or Continue on later steps.
    if (step === "home" || nav) {
      return continueForward();
    }

    let moved = false;
    const onPop = () => {
      moved = true;
    };
    window.addEventListener("popstate", onPop, { once: true });
    history.forward();
    window.setTimeout(() => {
      window.removeEventListener("popstate", onPop);
      if (!moved) continueForward();
    }, 50);
    return true;
  }, [showSettings, showGuide, continueForward, step]);

  // Keep React state in sync with browser / Android back & forward.
  useEffect(() => {
    replaceAppHist({ app: 1, step: "home" });
    const onPop = (e: PopStateEvent) => {
      const s = readAppHist(e.state);
      setShowSettings(s.overlay === "settings");
      setShowGuide(s.overlay === "guide");
      setStep(s.step);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    /** If native history forward didn't move us, advance like Continue. */
    const synthesizeForwardIfNeeded = () => {
      const before = stepRef.current;
      window.setTimeout(() => {
        if (stepRef.current !== before) return;
        if (showSettings || showGuide || currentAppHist().overlay) return;
        // Home Import needs a direct gesture — handled synchronously in onMouseUp.
        if (stepRef.current === "home") return;
        continueForward();
      }, 50);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showSettings || showGuide || step !== "home") {
          e.preventDefault();
          goBack();
        }
        return;
      }
      // Alt+→ / BrowserForward — prefer real history forward, else Continue/Import.
      if (
        e.key === "BrowserForward" ||
        (e.altKey && e.key === "ArrowRight")
      ) {
        e.preventDefault();
        goForward();
      }
    };
    // Mouse side-button forward: browser often history.forward()s first.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 4) return;
      if (stepRef.current === "home") {
        const nav = window.navigation as { canGoForward?: boolean } | undefined;
        if (!nav?.canGoForward) {
          continueForward();
          return;
        }
      }
      synthesizeForwardIfNeeded();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    goBack,
    goForward,
    continueForward,
    showSettings,
    showGuide,
    step
  ]);

  const focusSection = useCallback((index: number) => {
    setFocusedSectionIndex(index);
    setReviewDwellIndex(index);
  }, []);

  const completeDwellReview = useCallback((index: number) => {
    setSections((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      if (cur.pendingReview) {
        return prev.map((s, i) =>
          i === index ? { ...s, pendingReview: false } : s
        );
      }
      if (cur.pendingNoteConfirm) {
        return prev.map((s, i) =>
          i === index
            ? { ...s, pendingNoteConfirm: false, needsAttention: false }
            : s
        );
      }
      return prev;
    });
  }, []);

  const handleSettingsSave = useCallback(
    (next: AppSettings) => {
      setSettings(next);
      saveSettings(next);
      setMetadata((m) => ({
        ...m,
        companyName: next.companyName,
        website: next.website
      }));
      dismissOverlay();
    },
    [dismissOverlay]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setBusy("Reading document...");
      setError(null);
      setAiErrors({});
      aiBatchAbortRef.current?.abort();
      aiBatchAbortRef.current = null;
      setAiBatchRunning(false);
      try {
        const data = await file.arrayBuffer();
        const parsed = await parseShorthandDocx(data);
        setSections(matchEntries(parsed.entries));
        setWarnings(parsed.warnings);
        setFocusedSectionIndex(0);
        setReviewDwellIndex(null);
        navigateTo("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [navigateTo]
  );

  // Test hook: ?sample=<url> loads a document over HTTP through the same
  // pipeline as the file picker (used by automated tests; harmless otherwise).
  useEffect(() => {
    const sample = new URLSearchParams(window.location.search).get("sample");
    if (!sample) return;
    fetch(sample)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`Sample fetch failed (${r.status})`))))
      .then((b) => handleFile(new File([b], "sample.docx")))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSection = useCallback((index: number, next: SectionState) => {
    setSections((prev) => prev.map((s, i) => (i === index ? next : s)));
  }, []);

  const runAiForSection = useCallback(
    async (index: number) => {
      const ai = activeAi(settings);
      if (!ai.apiKey) {
        setError(
          `Add your ${ai.provider === "gemini" ? "Gemini" : "Claude"} API key in Settings first.`
        );
        openSettings();
        return;
      }
      setBusy(`Asking AI about section ${sections[index].entry.number}...`);
      setBusySectionIndex(index);
      setAiErrors((prev) => {
        if (!(index in prev)) return prev;
        const next = { ...prev };
        delete next[index];
        return next;
      });
      try {
        const resolved = await resolveSectionWithAi(sections, index, ai);
        updateSection(index, resolved);
      } catch (err) {
        setAiErrors((prev) => ({
          ...prev,
          [index]: err instanceof Error ? err.message : String(err)
        }));
      } finally {
        setBusy(null);
        setBusySectionIndex(null);
      }
    },
    [sections, settings, updateSection, openSettings]
  );

  const runAiForAllFlagged = useCallback(async () => {
    const ai = activeAi(settings);
    if (!ai.apiKey) {
      setError(
        `Add your ${ai.provider === "gemini" ? "Gemini" : "Claude"} API key in Settings first.`
      );
      openSettings();
      return;
    }

    aiBatchAbortRef.current?.abort();
    const ac = new AbortController();
    aiBatchAbortRef.current = ac;
    setAiBatchRunning(true);
    setAiErrors({});

    // Work on a local copy so each resolution sees the previous results
    // (needed for cross-references), publishing progress as we go.
    let current = sections;
    const flagged = current
      .map((s, i) => (s.needsAttention ? i : -1))
      .filter((i) => i >= 0);
    let done = 0;
    try {
      for (const index of flagged) {
        if (ac.signal.aborted) break;
        done += 1;
        setBusy(
          `AI reviewing section ${current[index].entry.number} (${done}/${flagged.length})...`
        );
        setBusySectionIndex(index);
        try {
          const resolved = await resolveSectionWithAi(current, index, ai, ac.signal);
          current = current.map((s, i) => (i === index ? resolved : s));
          setSections(current);
        } catch (err) {
          if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
            break;
          }
          setAiErrors({
            [index]: `${err instanceof Error ? err.message : String(err)} — stopped; earlier sections were kept.`
          });
          break;
        }
      }
    } finally {
      if (aiBatchAbortRef.current === ac) aiBatchAbortRef.current = null;
      setAiBatchRunning(false);
      setBusy(null);
      setBusySectionIndex(null);
    }
  }, [sections, settings, openSettings]);

  const stopAiBatch = useCallback(() => {
    aiBatchAbortRef.current?.abort();
  }, []);

  const dismissAiError = useCallback((index: number) => {
    setAiErrors((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSections([]);
    setWarnings([]);
    setExtras(defaultExtras);
    setMetadata(defaultMetadata(settings));
    setError(null);
    setAiErrors({});
    aiBatchAbortRef.current?.abort();
    aiBatchAbortRef.current = null;
    setAiBatchRunning(false);
    setFocusedSectionIndex(0);
    setReviewDwellIndex(null);
    setShowSettings(false);
    setShowGuide(false);
    setStep("home");
    replaceAppHist({ app: 1, step: "home" });
  }, [settings]);

  return (
    <div
      className={`app${showIntro ? " intro-locked" : ""}${
        step === "home" ? " app-home" : ""
      }${
        step === "review" || step === "details" || step === "generate" ? " app-aside" : ""
      }`}
    >
      <AmbientGlow />
      {showIntro && <IntroSplash onDone={dismissIntro} />}
      {step !== "home" && (
        <header className="topbar">
          <button
            type="button"
            className="topbar-btn topbar-btn-icon"
            aria-label="Back"
            onClick={() => goBack()}
          >
            <span className="topbar-btn-glyph" aria-hidden>
              <IconBack />
            </span>
            <span className="topbar-btn-label">Back</span>
          </button>
          <h1 className="topbar-title">
            {step === "review" && "Review sections"}
            {step === "details" && "Report details"}
            {step === "generate" && "Generate"}
          </h1>
          <button
            type="button"
            className="topbar-btn topbar-btn-icon"
            aria-label="Settings"
            onClick={openSettings}
          >
            <span className="topbar-btn-glyph" aria-hidden>
              <IconSettings />
            </span>
            <span className="topbar-btn-label">Settings</span>
          </button>
        </header>
      )}

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error} <span className="banner-dismiss">(tap to dismiss)</span>
        </div>
      )}
      {busy && (
        <div className={`banner busy${busySectionIndex !== null ? " ai" : ""}`}>
          {busySectionIndex !== null && <span className="ai-spinner" aria-hidden />}
          {busy}
        </div>
      )}

      <main className="content">
        {step === "home" && (
          <HomeScreen
            onFile={handleFile}
            busy={busy !== null}
            onShowGuide={openGuide}
            onShowSettings={openSettings}
            importTriggerRef={importTriggerRef}
          />
        )}
        {step === "review" && (
          <ReviewScreen
            sections={sections}
            warnings={warnings}
            flaggedCount={flaggedCount}
            aiConfigured={activeAi(settings).apiKey.length > 0}
            busy={busy !== null}
            busySectionIndex={busySectionIndex}
            onChange={updateSection}
            onAskAi={runAiForSection}
            onAskAiAll={runAiForAllFlagged}
            onStopAiBatch={stopAiBatch}
            aiBatchRunning={aiBatchRunning}
            aiErrors={aiErrors}
            onDismissAiError={dismissAiError}
            onContinue={() => navigateTo("details")}
            onFocusSection={focusSection}
            focusedSectionIndex={focusedSectionIndex}
            dwellSectionIndex={reviewDwellIndex}
          />
        )}
        {step === "details" && (
          <DetailsScreen
            metadata={metadata}
            extras={extras}
            onMetadata={setMetadata}
            onExtras={setExtras}
            onContinue={() => navigateTo("generate")}
          />
        )}
        {step === "generate" && (
          <GenerateScreen
            sections={sections}
            metadata={metadata}
            extras={extras}
            flaggedCount={flaggedCount}
            onRestart={reset}
          />
        )}
      </main>

      {showSettings && (
        <SettingsSheet
          settings={settings}
          onSave={handleSettingsSave}
          onClose={dismissOverlay}
        />
      )}

      {showGuide && <KeywordGuide onClose={dismissOverlay} />}

      {(step === "review" || step === "details" || step === "generate") &&
        sections.length > 0 && (
        <StudioAside
          step={step}
          sections={sections}
          focusedIndex={focusedSectionIndex}
          dwellIndex={step === "review" ? reviewDwellIndex : null}
          busySectionIndex={busySectionIndex}
          aiErrorSectionNums={aiErrorSectionNums}
          onJumpSection={focusSection}
          onDwellComplete={completeDwellReview}
        />
      )}
    </div>
  );
}
