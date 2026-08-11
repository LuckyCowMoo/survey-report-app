import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeScreen from "./components/HomeScreen";
import PastReportsScreen from "./components/PastReportsScreen";
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
import {
  applyDetailsSuggestions,
  normalizeReportExtras,
  PartialDetailsSuggestError,
  suggestDetailsExtras,
  type DetailsSuggestScope
} from "./lib/detailsSuggest";
import {
  activeAi,
  activeDetailsSuggestAi,
  loadSettings,
  saveSettings,
  type AppSettings
} from "./lib/settings";
import { usePointerInputMode } from "./lib/pointerInput";
import {
  currentAppHist,
  pushAppHist,
  readAppHist,
  replaceAppHist,
  type AppStep
} from "./lib/appHistory";
import {
  findLatestLibraryMatchBySource,
  loadLibraryProject,
  saveProjectDraftToLibrary,
  type LibraryReportMeta
} from "./lib/reportLibrary";
import {
  buildReportProject,
  encodeReportProject,
  fingerprintSourceEntries,
  fingerprintSourceSections,
  type ReportProject
} from "./lib/reportProject";
import { reportFileName } from "./lib/docxGenerator";
import { coverThumbnailBlob, houseNameFromAddress } from "./lib/reportCover";
import type { ReportExtras, ReportMetadata, SectionState } from "./types";

type Step = AppStep;

type PendingSourceMatch = {
  sections: SectionState[];
  warnings: string[];
  match: LibraryReportMeta;
};

function libraryDisplayTitle(report: LibraryReportMeta): string {
  return (
    report.fileName.replace(/\.docx$/i, "").replace(/\.dmsr$/i, "") ||
    "Untitled report"
  );
}

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
  timeEstimate: "5-7 days",
  aiSuggested: {
    issues: {
      risingDamp: false,
      penetratingDamp: false,
      condensation: false
    },
    issueReasons: {},
    recommendationIds: [],
    recommendationReasons: {},
    costItemIds: [],
    costReasons: {}
  }
};

export default function App() {
  usePointerInputMode();
  const { showIntro, dismissIntro } = useIntroSplash();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [focusedSectionIndex, setFocusedSectionIndex] = useState<number | null>(
    null
  );
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
  const [pendingSourceMatch, setPendingSourceMatch] =
    useState<PendingSourceMatch | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [detailsSuggestBusy, setDetailsSuggestBusy] =
    useState<DetailsSuggestScope | null>(null);
  const [detailsSuggestError, setDetailsSuggestError] = useState<{
    scope: DetailsSuggestScope;
    message: string;
  } | null>(null);
  const detailsSuggestRanRef = useRef(false);
  const detailsSuggestAbortRef = useRef<AbortController | null>(null);
  const [saveAndLeaveBusy, setSaveAndLeaveBusy] = useState(false);

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

    const nav = (window as unknown as { navigation?: { canGoForward?: boolean } })
      .navigation;
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
        const nav = (window as unknown as { navigation?: { canGoForward?: boolean } })
      .navigation;
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

  const beginFreshImport = useCallback(
    (nextSections: SectionState[], nextWarnings: string[]) => {
      setSections(nextSections);
      setWarnings(nextWarnings);
      setFocusedSectionIndex(null);
      setReviewDwellIndex(null);
      detailsSuggestRanRef.current = false;
      setDetailsSuggestError(null);
      navigateTo("review");
    },
    [navigateTo]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setBusy("Reading document...");
      setError(null);
      setAiErrors({});
      setPendingSourceMatch(null);
      aiBatchAbortRef.current?.abort();
      aiBatchAbortRef.current = null;
      setAiBatchRunning(false);
      try {
        const data = await file.arrayBuffer();
        const parsed = await parseShorthandDocx(data);
        const nextSections = matchEntries(parsed.entries);
        const fingerprint = await fingerprintSourceEntries(parsed.entries);
        const match = await findLatestLibraryMatchBySource(fingerprint);
        if (match) {
          setPendingSourceMatch({
            sections: nextSections,
            warnings: parsed.warnings,
            match
          });
          return;
        }
        beginFreshImport(nextSections, parsed.warnings);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [beginFreshImport]
  );

  /** Reopen a proprietary past-report project at pre-generation design state. */
  const openProject = useCallback(
    (project: ReportProject) => {
      setError(null);
      setAiErrors({});
      aiBatchAbortRef.current?.abort();
      aiBatchAbortRef.current = null;
      setAiBatchRunning(false);
      setBusySectionIndex(null);
      setBusy(null);
      setSections(project.sections);
      setWarnings(project.warnings);
      setMetadata(project.metadata);
      setExtras(normalizeReportExtras(project.extras));
      setFocusedSectionIndex(null);
      setReviewDwellIndex(null);
      detailsSuggestRanRef.current = false;
      setDetailsSuggestError(null);
      // Stack review under details so Back from details returns to section review.
      navigateTo("review");
      if (project.step === "details") {
        navigateTo("details");
      }
    },
    [navigateTo]
  );

  const resumeMatchedProject = useCallback(async () => {
    if (!pendingSourceMatch || resumeBusy) return;
    setResumeBusy(true);
    setError(null);
    try {
      const project = await loadLibraryProject(pendingSourceMatch.match.id);
      setPendingSourceMatch(null);
      openProject(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResumeBusy(false);
    }
  }, [pendingSourceMatch, resumeBusy, openProject]);

  const startFreshDespiteMatch = useCallback(() => {
    if (!pendingSourceMatch || resumeBusy) return;
    const { sections: nextSections, warnings: nextWarnings } =
      pendingSourceMatch;
    setPendingSourceMatch(null);
    beginFreshImport(nextSections, nextWarnings);
  }, [pendingSourceMatch, resumeBusy, beginFreshImport]);

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

  const runDetailsSuggest = useCallback(
    async (scope: DetailsSuggestScope) => {
      const ai = activeDetailsSuggestAi(settings);
      if (!ai.apiKey) {
        setDetailsSuggestError({
          scope,
          message: `Add your ${ai.provider === "gemini" ? "Gemini" : "Claude"} API key in Settings first.`
        });
        openSettings();
        return;
      }
      detailsSuggestAbortRef.current?.abort();
      const ac = new AbortController();
      detailsSuggestAbortRef.current = ac;
      setDetailsSuggestBusy(scope);
      setDetailsSuggestError(null);
      try {
        const suggestion = await suggestDetailsExtras(
          sections,
          ai,
          scope,
          ac.signal
        );
        if (ac.signal.aborted) return;
        setExtras((prev) => applyDetailsSuggestions(prev, suggestion, scope));
        detailsSuggestRanRef.current = true;
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        if (err instanceof PartialDetailsSuggestError) {
          setExtras((prev) => applyDetailsSuggestions(prev, err.result, scope));
          detailsSuggestRanRef.current = true;
        }
        setDetailsSuggestError({
          scope,
          message: err instanceof Error ? err.message : String(err)
        });
      } finally {
        if (detailsSuggestAbortRef.current === ac) {
          detailsSuggestAbortRef.current = null;
        }
        setDetailsSuggestBusy(null);
      }
    },
    [sections, settings, openSettings]
  );

  // Auto-suggest once ~5s after opening details (when enabled and not yet run).
  useEffect(() => {
    if (step !== "details") return;
    if (!settings.autoSuggestDetailsExtras) return;
    if (detailsSuggestRanRef.current) return;
    if (detailsSuggestBusy) return;
    if (!activeDetailsSuggestAi(settings).apiKey) return;

    const timer = window.setTimeout(() => {
      if (detailsSuggestRanRef.current) return;
      void runDetailsSuggest("all");
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [step, settings, detailsSuggestBusy, runDetailsSuggest]);

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
    setFocusedSectionIndex(null);
    setReviewDwellIndex(null);
    setShowSettings(false);
    setShowGuide(false);
    setPendingSourceMatch(null);
    detailsSuggestAbortRef.current?.abort();
    detailsSuggestAbortRef.current = null;
    detailsSuggestRanRef.current = false;
    setDetailsSuggestBusy(null);
    setDetailsSuggestError(null);
    setSaveAndLeaveBusy(false);
    setStep("home");
    replaceAppHist({ app: 1, step: "home" });
  }, [settings]);

  const saveAndLeave = useCallback(async () => {
    if (sections.length === 0 || saveAndLeaveBusy) return;
    const designStep = step === "review" ? "review" : "details";
    setSaveAndLeaveBusy(true);
    setError(null);
    try {
      const fileName = reportFileName(metadata);
      const coverThumb = await coverThumbnailBlob(sections);
      const sourceFingerprint = await fingerprintSourceSections(sections);
      const projectBlob = encodeReportProject(
        buildReportProject({
          sections,
          metadata,
          extras,
          warnings,
          fileName,
          step: designStep,
          sourceFingerprint
        })
      );
      await saveProjectDraftToLibrary({
        projectBlob,
        fileName,
        propertyAddress: metadata.propertyAddress,
        houseName: houseNameFromAddress(metadata.propertyAddress),
        clientName: metadata.clientName,
        surveyDate: metadata.surveyDate,
        coverThumb,
        sourceFingerprint,
        step: designStep
      });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaveAndLeaveBusy(false);
    }
  }, [
    sections,
    saveAndLeaveBusy,
    step,
    metadata,
    extras,
    warnings,
    reset
  ]);

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
            {step === "past" && "Past reports"}
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
            onShowPastReports={() => navigateTo("past")}
            importTriggerRef={importTriggerRef}
          />
        )}
        {step === "past" && (
          <PastReportsScreen onOpenProject={openProject} />
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
            onSaveAndLeave={() => void saveAndLeave()}
            saveAndLeaveBusy={saveAndLeaveBusy}
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
            onSaveAndLeave={() => void saveAndLeave()}
            saveAndLeaveBusy={saveAndLeaveBusy}
            aiConfigured={activeDetailsSuggestAi(settings).apiKey.length > 0}
            suggestBusy={detailsSuggestBusy}
            suggestError={detailsSuggestError}
            onAskAi={runDetailsSuggest}
            onDismissSuggestError={() => setDetailsSuggestError(null)}
          />
        )}
        {step === "generate" && (
          <GenerateScreen
            sections={sections}
            metadata={metadata}
            extras={extras}
            warnings={warnings}
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

      {pendingSourceMatch && (
        <div
          className="sheet-backdrop"
          onClick={() => {
            if (!resumeBusy) setPendingSourceMatch(null);
          }}
        >
          <div
            className="sheet past-delete-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resume-match-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="resume-match-title">Continue saved report?</h2>
            <p>
              This field notes document matches{" "}
              <strong>{libraryDisplayTitle(pendingSourceMatch.match)}</strong>
              {pendingSourceMatch.match.houseName ||
              pendingSourceMatch.match.clientName
                ? ` (${[
                    pendingSourceMatch.match.houseName,
                    pendingSourceMatch.match.clientName
                  ]
                    .filter(Boolean)
                    .join(" · ")})`
                : ""}
              . Continue from that saved work, or start a new report from the
              import?
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn"
                disabled={resumeBusy}
                onClick={startFreshDespiteMatch}
              >
                Start fresh
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={resumeBusy}
                onClick={() => void resumeMatchedProject()}
              >
                {resumeBusy ? "Opening…" : "Continue saved"}
              </button>
            </div>
          </div>
        </div>
      )}

      {(step === "review" || step === "details" || step === "generate") &&
        sections.length > 0 && (
        <StudioAside
          step={step}
          sections={sections}
          focusedIndex={focusedSectionIndex}
          dwellIndex={step === "review" ? reviewDwellIndex : null}
          busySectionIndex={busySectionIndex}
          aiErrorSectionNums={aiErrorSectionNums}
          pipJumpOnHover={settings.pipJumpOnHover}
          studioPhotoPassThrough={settings.studioPhotoPassThrough}
          onJumpSection={focusSection}
          onDwellComplete={completeDwellReview}
        />
      )}
    </div>
  );
}
