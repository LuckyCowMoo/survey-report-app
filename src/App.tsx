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
import type { ReportExtras, ReportMetadata, SectionState } from "./types";

type Step = "home" | "review" | "details" | "generate";

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

  const focusSection = useCallback((index: number) => {
    setFocusedSectionIndex(index);
    setReviewDwellIndex(index);
  }, []);

  const completeDwellReview = useCallback((index: number) => {
    setSections((prev) => {
      const cur = prev[index];
      if (!cur?.pendingReview) return prev;
      return prev.map((s, i) => (i === index ? { ...s, pendingReview: false } : s));
    });
  }, []);

  const handleSettingsSave = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
    setMetadata((m) => ({
      ...m,
      companyName: next.companyName,
      website: next.website
    }));
    setShowSettings(false);
  }, []);

  const handleFile = useCallback(async (file: File) => {
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
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

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
        setShowSettings(true);
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
    [sections, settings, updateSection]
  );

  const runAiForAllFlagged = useCallback(async () => {
    const ai = activeAi(settings);
    if (!ai.apiKey) {
      setError(
        `Add your ${ai.provider === "gemini" ? "Gemini" : "Claude"} API key in Settings first.`
      );
      setShowSettings(true);
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
  }, [sections, settings]);

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
    setStep("home");
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
            onClick={() =>
              setStep(step === "review" ? "home" : step === "details" ? "review" : "details")
            }
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
            onClick={() => setShowSettings(true)}
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
            onShowGuide={() => setShowGuide(true)}
            onShowSettings={() => setShowSettings(true)}
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
            onContinue={() => setStep("details")}
            onFocusSection={focusSection}
            focusedSectionIndex={focusedSectionIndex}
          />
        )}
        {step === "details" && (
          <DetailsScreen
            metadata={metadata}
            extras={extras}
            onMetadata={setMetadata}
            onExtras={setExtras}
            onContinue={() => setStep("generate")}
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
          onClose={() => setShowSettings(false)}
        />
      )}

      {showGuide && <KeywordGuide onClose={() => setShowGuide(false)} />}

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
