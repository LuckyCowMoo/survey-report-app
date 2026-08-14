import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeScreen from "./components/HomeScreen";
import PastReportsScreen from "./components/PastReportsScreen";
import FieldNotesScreen from "./components/FieldNotesScreen";
import ReviewScreen from "./components/ReviewScreen";
import DetailsScreen from "./components/DetailsScreen";
import GenerateScreen from "./components/GenerateScreen";
import SettingsSheet from "./components/SettingsSheet";
import KeywordGuide from "./components/KeywordGuide";
import SheetShell from "./components/SheetShell";
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
  applyApiKey,
  ensureProviderModels,
  loadSettings,
  saveSettings,
  providerLabel,
  type AppSettings
} from "./lib/settings";
import type { AiProvider } from "./lib/aiProviders";
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
import {
  getScrollRoot,
  markProgrammaticScroll,
  scrollElementIntoViewCentered,
  writeScrollTop
} from "./lib/scrollRoot";
import { startOrientationGuard } from "./lib/orientationGuard";
import { reorderArray } from "./lib/sectionLift";
import { fieldNotesForReviewReturn, fieldNotesToShorthand, renumberFieldNotes } from "./lib/fieldNotes";
import {
  generateShorthandDocx,
  shorthandDocxFileName
} from "./lib/shorthandDocxGenerator";
import { compositeAnnotationsOntoJpeg } from "./lib/annotationComposite";
import type {
  FieldNoteShot,
  PhotoAnnotation,
  ReportExtras,
  ReportMetadata,
  SectionState
} from "./types";

type Step = AppStep;
type DesignStep = "review" | "details";

type PendingSourceMatch = {
  sections: SectionState[];
  warnings: string[];
  match: LibraryReportMeta;
};

function designStepForPersist(step: Step): DesignStep | null {
  if (step === "review") return "review";
  if (step === "details" || step === "generate") return "details";
  return null;
}

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
    contactName: settings.surveyorName.trim(),
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
  excludePlanCosts: false,
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

  useEffect(() => startOrientationGuard(), []);
  const { showIntro, dismissIntro } = useIntroSplash();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);

  // Fix leftover model ids from another provider (e.g. Claude on Gemini).
  useEffect(() => {
    setSettings((prev) => {
      const fixed = ensureProviderModels(prev);
      if (fixed === prev) return prev;
      saveSettings(fixed);
      return fixed;
    });
  }, []);
  const [showGuide, setShowGuide] = useState(false);
  const [focusedSectionIndex, setFocusedSectionIndex] = useState<number | null>(
    null
  );
  /** Section the user has actively focused; dwell timer only runs for this. */
  const [reviewDwellIndex, setReviewDwellIndex] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("home");
  const [fieldNotes, setFieldNotes] = useState<FieldNoteShot[]>([]);
  const [tutorialMode, setTutorialMode] = useState(false);
  const fieldNotesSessionKeyRef = useRef(`fieldnotes:${crypto.randomUUID()}`);
  /** Stable upsert key for mid-flow .dmsr drafts (survives AI text edits). */
  const draftFingerprintRef = useRef<string | null>(null);
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
  /** While true, batch AI keeps the list scrolled to the section being generated. */
  const aiBatchFollowRef = useRef(false);
  const aiBatchRunningRef = useRef(false);
  const busySectionIndexRef = useRef<number | null>(null);
  const stepRef = useRef(step);
  const sectionsRef = useRef(sections);
  const fieldNotesRef = useRef(fieldNotes);
  const metadataRef = useRef(metadata);
  const extrasRef = useRef(extras);
  const warningsRef = useRef(warnings);
  const settingsRef = useRef(settings);
  aiBatchRunningRef.current = aiBatchRunning;
  busySectionIndexRef.current = busySectionIndex;
  stepRef.current = step;
  sectionsRef.current = sections;
  fieldNotesRef.current = fieldNotes;
  metadataRef.current = metadata;
  extrasRef.current = extras;
  warningsRef.current = warnings;
  settingsRef.current = settings;
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
  const [showIdentityPrompt, setShowIdentityPrompt] = useState(false);
  const [settingsFocusIdentity, setSettingsFocusIdentity] = useState(false);
  const [showBatchGuidancePrompt, setShowBatchGuidancePrompt] = useState(false);
  const [batchGuidanceDraft, setBatchGuidanceDraft] = useState("");

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

  const navigateTo = useCallback((next: Step) => {
    setStep(next);
    pushAppHist({ app: 1, step: next });
  }, []);

  // Always open review / details scrolled to the top.
  useEffect(() => {
    if (step !== "review" && step !== "details") return;
    markProgrammaticScroll(300);
    writeScrollTop(getScrollRoot(), 0);
    // After layout (aside/content mount), pin top again.
    const id = window.requestAnimationFrame(() => {
      writeScrollTop(getScrollRoot(), 0);
    });
    return () => window.cancelAnimationFrame(id);
  }, [step]);

  const openSettings = useCallback((opts?: { focusIdentity?: boolean }) => {
    setSettingsFocusIdentity(Boolean(opts?.focusIdentity));
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
      setSettingsFocusIdentity(false);
    }
  }, []);

  const goBack = useCallback(() => {
    if (showSettings || showGuide || step !== "home") {
      history.back();
      return true;
    }
    return false;
  }, [showSettings, showGuide, step]);

  const goToGenerate = useCallback(() => {
    const missingName = !settings.surveyorName.trim();
    const missingCompany = !settings.companyName.trim();
    const missingWebsite = !settings.website.trim();
    if (missingName || missingCompany || missingWebsite) {
      setShowIdentityPrompt(true);
      return false;
    }
    setMetadata((m) => ({
      ...m,
      contactName: settings.surveyorName.trim(),
      companyName: settings.companyName.trim(),
      website: settings.website.trim()
    }));
    navigateTo("generate");
    return true;
  }, [
    settings.surveyorName,
    settings.companyName,
    settings.website,
    navigateTo
  ]);

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
      return goToGenerate();
    }
    return false;
  }, [step, sections.length, navigateTo, busy, goToGenerate]);

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
      if (s.overlay !== "settings") setSettingsFocusIdentity(false);
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
    // Tapping the live AI section re-engages camera follow for following sections.
    if (
      aiBatchRunningRef.current &&
      busySectionIndexRef.current !== null &&
      index === busySectionIndexRef.current
    ) {
      aiBatchFollowRef.current = true;
    }
    setFocusedSectionIndex(index);
    setReviewDwellIndex(index);
  }, []);

  // Follow each section as batch AI works it; stop only on intentional user scroll.
  useEffect(() => {
    if (!aiBatchRunning) {
      aiBatchFollowRef.current = false;
      return;
    }

    const cancelFollow = () => {
      aiBatchFollowRef.current = false;
    };

    const root = getScrollRoot();
    const scrollTrack = document.querySelector(".studio-scroll");

    // Wheel / touch / custom scrollbar = user scrolling away.
    // Do not listen to plain "scroll" — layout chase + follow animation also scroll.
    window.addEventListener("wheel", cancelFollow, { passive: true });
    window.addEventListener("touchmove", cancelFollow, { passive: true });
    if (root instanceof HTMLElement) {
      root.addEventListener("wheel", cancelFollow, { passive: true });
      root.addEventListener("touchmove", cancelFollow, { passive: true });
    }
    scrollTrack?.addEventListener("pointerdown", cancelFollow);

    return () => {
      window.removeEventListener("wheel", cancelFollow);
      window.removeEventListener("touchmove", cancelFollow);
      if (root instanceof HTMLElement) {
        root.removeEventListener("wheel", cancelFollow);
        root.removeEventListener("touchmove", cancelFollow);
      }
      scrollTrack?.removeEventListener("pointerdown", cancelFollow);
    };
  }, [aiBatchRunning]);

  useEffect(() => {
    if (!aiBatchRunning || busySectionIndex === null) return;
    if (!aiBatchFollowRef.current) return;
    const section = sectionsRef.current[busySectionIndex];
    if (!section) return;
    setFocusedSectionIndex(busySectionIndex);
    setReviewDwellIndex(busySectionIndex);
    const card = document.getElementById(`section-card-${section.entry.number}`);
    if (card) scrollElementIntoViewCentered(card);
  }, [aiBatchRunning, busySectionIndex]);

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

  const handleGuideApiKey = useCallback(
    (apiKey: string, provider: AiProvider) => {
      const next = applyApiKey(settings, apiKey, provider);
      setSettings(next);
      saveSettings(next);
    },
    [settings]
  );

  const handleSettingsSave = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
    setMetadata((m) => ({
      ...m,
      companyName: next.companyName,
      website: next.website,
      contactName: next.surveyorName.trim()
    }));
    if (
      next.surveyorName.trim() &&
      next.companyName.trim() &&
      next.website.trim()
    ) {
      setShowIdentityPrompt(false);
    }
  }, []);

  const beginFreshImport = useCallback(
    (nextSections: SectionState[], nextWarnings: string[]) => {
      setSections(nextSections);
      setWarnings(nextWarnings);
      setFocusedSectionIndex(null);
      setReviewDwellIndex(null);
      detailsSuggestRanRef.current = false;
      setDetailsSuggestError(null);
      setFieldNotes([]);
      draftFingerprintRef.current = null;
      void fingerprintSourceSections(nextSections).then((fp) => {
        draftFingerprintRef.current = fp;
      });
      navigateTo("review");
    },
    [navigateTo]
  );

  const startFieldNotes = useCallback(() => {
    setError(null);
    setFieldNotes([]);
    setTutorialMode(false);
    fieldNotesSessionKeyRef.current = `fieldnotes:${crypto.randomUUID()}`;
    navigateTo("fieldNotes");
  }, [navigateTo]);

  const startTutorial = useCallback(() => {
    setError(null);
    setFieldNotes([]);
    setTutorialMode(true);
    fieldNotesSessionKeyRef.current = `fieldnotes:${crypto.randomUUID()}`;
    navigateTo("fieldNotes");
  }, [navigateTo]);

  const openFieldNotesFromReview = useCallback(() => {
    setError(null);
    setFieldNotes((prev) => fieldNotesForReviewReturn(sections, prev));
    navigateTo("fieldNotes");
  }, [navigateTo, sections]);

  /** Quiet .dmsr upsert — no busy UI, no reset, does not abort AI. */
  const persistReportDraftQuiet = useCallback(
    async (opts?: {
      sections?: SectionState[];
      metadata?: ReportMetadata;
      extras?: ReportExtras;
      warnings?: string[];
      designStep?: DesignStep;
    }) => {
      const secs = opts?.sections ?? sectionsRef.current;
      if (secs.length === 0) return;
      const meta = opts?.metadata ?? metadataRef.current;
      const nextExtras = opts?.extras ?? extrasRef.current;
      const nextWarnings = opts?.warnings ?? warningsRef.current;
      const designStep =
        opts?.designStep ??
        designStepForPersist(stepRef.current) ??
        "review";
      let sourceFingerprint = draftFingerprintRef.current;
      if (!sourceFingerprint) {
        sourceFingerprint = await fingerprintSourceSections(secs);
        draftFingerprintRef.current = sourceFingerprint;
      }
      const fileName = reportFileName(meta);
      const coverThumb = await coverThumbnailBlob(secs);
      const projectBlob = encodeReportProject(
        buildReportProject({
          sections: secs,
          metadata: meta,
          extras: nextExtras,
          warnings: nextWarnings,
          fileName,
          step: designStep,
          sourceFingerprint
        })
      );
      await saveProjectDraftToLibrary({
        projectBlob,
        fileName,
        propertyAddress: meta.propertyAddress,
        houseName: houseNameFromAddress(meta.propertyAddress),
        clientName: meta.clientName,
        surveyDate: meta.surveyDate,
        coverThumb,
        sourceFingerprint,
        step: designStep
      });
    },
    []
  );

  const persistQueueRef = useRef(Promise.resolve());
  const enqueuePersistReport = useCallback(
    (opts?: Parameters<typeof persistReportDraftQuiet>[0]) => {
      persistQueueRef.current = persistQueueRef.current
        .then(() => persistReportDraftQuiet(opts))
        .catch(() => {});
    },
    [persistReportDraftQuiet]
  );
  const enqueuePersistReportRef = useRef(enqueuePersistReport);
  enqueuePersistReportRef.current = enqueuePersistReport;

  const saveFieldNotesDraft = useCallback(
    async (leaveHome: boolean, announce = leaveHome) => {
      const notes = fieldNotesRef.current;
      if (notes.length === 0) {
        if (leaveHome) {
          setFieldNotes([]);
          navigateTo("home");
        }
        return;
      }
      if (announce) {
        setBusy(leaveHome ? "Saving field notes…" : "Saving…");
      }
      setError(null);
      try {
        const entries = await fieldNotesToShorthand(notes);
        const nextSections = matchEntries(entries);
        const meta = defaultMetadata(settingsRef.current);
        const fileName = reportFileName(meta).replace(/\.docx$/i, "") + ".dmsr";
        const coverThumb = await coverThumbnailBlob(nextSections);
        // Stable session key while capturing so autosave upserts one draft row.
        // Final leave uses content fingerprint for resume-after-reimport.
        const sourceFingerprint = leaveHome
          ? await fingerprintSourceEntries(entries)
          : fieldNotesSessionKeyRef.current;
        if (!leaveHome) {
          draftFingerprintRef.current = sourceFingerprint;
        }
        const projectBlob = encodeReportProject(
          buildReportProject({
            sections: nextSections,
            metadata: meta,
            extras: defaultExtras,
            warnings: [],
            fileName,
            step: "review",
            sourceFingerprint
          })
        );
        await saveProjectDraftToLibrary({
          projectBlob,
          fileName,
          propertyAddress: meta.propertyAddress,
          houseName: houseNameFromAddress(meta.propertyAddress),
          clientName: meta.clientName,
          surveyDate: meta.surveyDate,
          coverThumb,
          sourceFingerprint,
          step: "review"
        });
        if (leaveHome) {
          draftFingerprintRef.current = null;
          setFieldNotes([]);
          setStep("home");
          replaceAppHist({ app: 1, step: "home" });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (announce) setBusy(null);
      }
    },
    [navigateTo]
  );
  const saveFieldNotesDraftRef = useRef(saveFieldNotesDraft);
  saveFieldNotesDraftRef.current = saveFieldNotesDraft;

  const continueFieldNotesToReport = useCallback(() => {
    if (fieldNotes.length === 0) return;
    void (async () => {
      setBusy("Preparing report…");
      setError(null);
      try {
        const entries = await fieldNotesToShorthand(fieldNotes);
        const nextSections = matchEntries(entries);
        // Keep fieldNotes so Add more notes can return without re-burning photos.
        setSections(nextSections);
        setWarnings([]);
        setFocusedSectionIndex(null);
        setReviewDwellIndex(null);
        detailsSuggestRanRef.current = false;
        setDetailsSuggestError(null);
        draftFingerprintRef.current = fieldNotesSessionKeyRef.current;
        await saveFieldNotesDraft(false);
        navigateTo("review");
        enqueuePersistReport({
          sections: nextSections,
          designStep: "review"
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  }, [fieldNotes, navigateTo, saveFieldNotesDraft, enqueuePersistReport]);

  const exportFieldNotesDocx = useCallback(async (leaveHome = false) => {
    if (fieldNotes.length === 0) return;
    setBusy(leaveHome ? "Saving & exporting…" : "Saving & exporting…");
    setError(null);
    try {
      await saveFieldNotesDraft(false);
      const entries = await fieldNotesToShorthand(fieldNotes);
      const blob = await generateShorthandDocx(entries);
      const name = shorthandDocxFileName();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      if (leaveHome) {
        setFieldNotes([]);
        setStep("home");
        replaceAppHist({ app: 1, step: "home" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [fieldNotes, saveFieldNotesDraft]);

  // Autosave field-notes draft while capturing.
  useEffect(() => {
    if (step !== "fieldNotes" || fieldNotes.length === 0) return;
    const timer = window.setTimeout(() => {
      void saveFieldNotesDraft(false);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [step, fieldNotes, saveFieldNotesDraft]);

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
      draftFingerprintRef.current = project.sourceFingerprint ?? null;
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

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tutorial");
    if (q !== "1" && q !== "true") return;
    startTutorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSection = useCallback((index: number, next: SectionState) => {
    setSections((prev) => prev.map((s, i) => (i === index ? next : s)));
    setFieldNotes((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const shot = prev[index];
      if (!shot || shot.note === next.entry.note) return prev;
      return prev.map((s, i) =>
        i === index ? { ...s, note: next.entry.note } : s
      );
    });
  }, []);

  const deleteSection = useCallback((index: number) => {
    setSections((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      return prev
        .filter((_, i) => i !== index)
        .map((s, i) => ({
          ...s,
          entry: { ...s.entry, number: i + 1 }
        }));
    });
    setFieldNotes((prev) =>
      prev.length === 0
        ? prev
        : renumberFieldNotes(prev.filter((_, i) => i !== index))
    );
    setFocusedSectionIndex((i) => {
      if (i === null) return null;
      if (i === index) return null;
      return i > index ? i - 1 : i;
    });
    setReviewDwellIndex((i) => {
      if (i === null) return null;
      if (i === index) return null;
      return i > index ? i - 1 : i;
    });
    setAiErrors((errs) => {
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(errs)) {
        const oldIdx = Number(k);
        if (!Number.isFinite(oldIdx) || oldIdx === index) continue;
        out[oldIdx > index ? oldIdx - 1 : oldIdx] = v;
      }
      return out;
    });
  }, []);

  const annotateSection = useCallback(
    async (index: number, annotations: PhotoAnnotation[]) => {
      const section = sections[index];
      if (!section?.entry.images[0]) return;
      const raw = fieldNotes[index]?.image ?? section.entry.images[0];
      const burned = annotations.length
        ? await compositeAnnotationsOntoJpeg(raw, annotations)
        : new Uint8Array(raw);
      const ann = annotations.length ? annotations : undefined;
      setFieldNotes((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        return prev.map((s, i) =>
          i === index ? { ...s, annotations: ann } : s
        );
      });
      setSections((prev) =>
        prev.map((s, i) => {
          if (i !== index) return s;
          const images = s.entry.images.slice();
          images[0] = burned;
          return {
            ...s,
            entry: {
              ...s.entry,
              images,
              ...(ann ? { annotations: ann } : { annotations: undefined })
            }
          };
        })
      );
    },
    [fieldNotes, sections]
  );

  const reorderSections = useCallback((from: number, to: number) => {
    setSections((prev) => {
      if (from < 0 || to < 0 || from >= prev.length) return prev;
      const next = reorderArray(prev, from, to);
      const unchanged = next.every(
        (s, i) => s.entry.number === prev[i]?.entry.number
      );
      if (unchanged) return prev;

      setFieldNotes((shots) =>
        shots.length === prev.length ? reorderArray(shots, from, to) : shots
      );

      const remap = (idx: number | null): number | null => {
        if (idx === null) return null;
        const num = prev[idx]?.entry.number;
        if (num == null) return idx;
        const found = next.findIndex((s) => s.entry.number === num);
        return found >= 0 ? found : idx;
      };

      setFocusedSectionIndex((i) => remap(i));
      setReviewDwellIndex((i) => remap(i));
      setBusySectionIndex((i) => remap(i));
      setAiErrors((errs) => {
        const out: Record<number, string> = {};
        for (const [k, v] of Object.entries(errs)) {
          const oldIdx = Number(k);
          if (!Number.isFinite(oldIdx)) continue;
          const num = prev[oldIdx]?.entry.number;
          if (num == null) continue;
          const ni = next.findIndex((s) => s.entry.number === num);
          if (ni >= 0) out[ni] = v;
        }
        return out;
      });

      return next;
    });
  }, []);

  const runAiForSection = useCallback(
    async (index: number) => {
      const ai = activeAi(settings);
      if (!ai.apiKey) {
        setError(
          `Add your ${providerLabel(ai.provider)} API key in Settings first.`
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
        const nextSections = sections.map((s, i) =>
          i === index ? resolved : s
        );
        updateSection(index, resolved);
        enqueuePersistReport({
          sections: nextSections,
          designStep: designStepForPersist(stepRef.current) ?? "review"
        });
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
    [sections, settings, updateSection, openSettings, enqueuePersistReport]
  );

  const requestAiForAllFlagged = useCallback(() => {
    const ai = activeAi(settings);
    if (!ai.apiKey) {
      setError(
        `Add your ${providerLabel(ai.provider)} API key in Settings first.`
      );
      openSettings();
      return;
    }
    setBatchGuidanceDraft("");
    setShowBatchGuidancePrompt(true);
  }, [settings, openSettings]);

  const runAiForAllFlagged = useCallback(
    async (guidance: string) => {
      const ai = activeAi(settings);
      if (!ai.apiKey) {
        setError(
          `Add your ${providerLabel(ai.provider)} API key in Settings first.`
        );
        openSettings();
        return;
      }

      setShowBatchGuidancePrompt(false);
      const guidanceTrimmed = guidance.trim();

      aiBatchAbortRef.current?.abort();
      const ac = new AbortController();
      aiBatchAbortRef.current = ac;
      aiBatchFollowRef.current = true;
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
            const resolved = await resolveSectionWithAi(
              current,
              index,
              ai,
              ac.signal,
              guidanceTrimmed ? { guidance: guidanceTrimmed } : undefined
            );
            current = current.map((s, i) => (i === index ? resolved : s));
            setSections(current);
            enqueuePersistReport({
              sections: current,
              designStep: designStepForPersist(stepRef.current) ?? "review"
            });
          } catch (err) {
            if (
              ac.signal.aborted ||
              (err instanceof DOMException && err.name === "AbortError")
            ) {
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
        aiBatchFollowRef.current = false;
        setAiBatchRunning(false);
        setBusy(null);
        setBusySectionIndex(null);
      }
    },
    [sections, settings, openSettings, enqueuePersistReport]
  );

  const stopAiBatch = useCallback(() => {
    aiBatchFollowRef.current = false;
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
          message: `Add your ${providerLabel(ai.provider)} API key in Settings first.`
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
        setExtras((prev) => {
          const next = applyDetailsSuggestions(prev, suggestion, scope);
          enqueuePersistReport({ extras: next, designStep: "details" });
          return next;
        });
        detailsSuggestRanRef.current = true;
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        if (err instanceof PartialDetailsSuggestError) {
          setExtras((prev) => {
            const next = applyDetailsSuggestions(prev, err.result, scope);
            enqueuePersistReport({ extras: next, designStep: "details" });
            return next;
          });
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
    [sections, settings, openSettings, enqueuePersistReport]
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
    setFieldNotes([]);
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
    setShowIdentityPrompt(false);
    setSettingsFocusIdentity(false);
    setShowBatchGuidancePrompt(false);
    setBatchGuidanceDraft("");
    draftFingerprintRef.current = null;
    setStep("home");
    replaceAppHist({ app: 1, step: "home" });
  }, [settings]);

  const saveMidFlowDraft = useCallback(
    async (designStep: DesignStep) => {
      if (sectionsRef.current.length === 0 || saveAndLeaveBusy) return;
      setSaveAndLeaveBusy(true);
      setError(null);
      aiBatchAbortRef.current?.abort();
      detailsSuggestAbortRef.current?.abort();
      try {
        setBusy("Saving draft…");
        await persistReportDraftQuiet({ designStep });
        draftFingerprintRef.current = null;
        reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSaveAndLeaveBusy(false);
      } finally {
        setBusy(null);
      }
    },
    [saveAndLeaveBusy, persistReportDraftQuiet, reset]
  );

  // Persist on every screen change; leaving to home also resets the session.
  const prevStepRef = useRef(step);
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (prev === step) return;
    if (step === "home") setTutorialMode(false);

    const isReport = (s: Step) =>
      s === "review" || s === "details" || s === "generate";

    if (prev === "fieldNotes" && fieldNotesRef.current.length > 0) {
      void saveFieldNotesDraft(false);
      if (step === "home") setFieldNotes([]);
      return;
    }

    if (step === "home" && isReport(prev)) {
      if (sectionsRef.current.length === 0 || saveAndLeaveBusy) return;
      const designStep: DesignStep = prev === "review" ? "review" : "details";
      void saveMidFlowDraft(designStep);
      return;
    }

    if (isReport(prev) && isReport(step) && sectionsRef.current.length > 0) {
      enqueuePersistReport({
        designStep: step === "review" ? "review" : "details"
      });
      return;
    }

    if (
      prev === "review" &&
      step === "fieldNotes" &&
      sectionsRef.current.length > 0
    ) {
      enqueuePersistReport({ designStep: "review" });
    }
  }, [
    step,
    saveAndLeaveBusy,
    saveMidFlowDraft,
    saveFieldNotesDraft,
    enqueuePersistReport
  ]);

  // Best-effort save when the tab hides, unloads, or the app is backgrounded.
  useEffect(() => {
    const flushDraft = () => {
      const s = stepRef.current;
      if (s === "fieldNotes" && fieldNotesRef.current.length > 0) {
        void saveFieldNotesDraftRef.current(false, false);
        return;
      }
      if (
        (s === "review" || s === "details" || s === "generate") &&
        sectionsRef.current.length > 0
      ) {
        enqueuePersistReportRef.current({
          designStep: designStepForPersist(s) ?? "review"
        });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    window.addEventListener("pagehide", flushDraft);
    window.addEventListener("beforeunload", flushDraft);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("freeze", flushDraft);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      window.removeEventListener("beforeunload", flushDraft);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("freeze", flushDraft);
    };
  }, []);

  return (
    <div
      className={`app${showIntro ? " intro-locked" : ""}${
        step === "home" ? " app-home" : ""
      }${
        step === "review" || step === "details" || step === "generate" ? " app-aside" : ""
      }${step === "fieldNotes" ? " app-field-notes" : ""}`}
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
            {step === "fieldNotes" && (tutorialMode ? "Tutorial" : "Field notes")}
            {step === "review" && "Review sections"}
            {step === "details" && "Report details"}
            {step === "generate" && "Generate"}
          </h1>
          <button
            type="button"
            className="topbar-btn topbar-btn-icon"
            aria-label="Settings"
            onClick={() => openSettings()}
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
          <            HomeScreen
            onFile={handleFile}
            onCreateFieldNotes={startFieldNotes}
            onStartTutorial={startTutorial}
            busy={busy !== null}
            onShowGuide={openGuide}
            onShowSettings={openSettings}
            onShowPastReports={() => navigateTo("past")}
            ctaMorph={settings.homeCtaMorph}
            importTriggerRef={importTriggerRef}
          />
        )}
        {step === "past" && (
          <PastReportsScreen onOpenProject={openProject} />
        )}
        {step === "fieldNotes" && (
          <FieldNotesScreen
            shots={fieldNotes}
            onChange={setFieldNotes}
            busy={busy !== null}
            onSaveInApp={() => void saveFieldNotesDraft(true)}
            onContinueToReport={continueFieldNotesToReport}
            onExportDocx={() => void exportFieldNotesDocx(true)}
            photoPassThrough={settings.studioPhotoPassThrough}
            tutorial={tutorialMode}
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
            onAskAiAll={requestAiForAllFlagged}
            onStopAiBatch={stopAiBatch}
            aiBatchRunning={aiBatchRunning}
            aiErrors={aiErrors}
            onDismissAiError={dismissAiError}
            onContinue={() => navigateTo("details")}
            onAddMoreNotes={openFieldNotesFromReview}
            onDeleteSection={deleteSection}
            onAnnotateSection={annotateSection}
            annotateBaseImage={(index) => fieldNotes[index]?.image ?? null}
            onFocusSection={focusSection}
            focusedSectionIndex={focusedSectionIndex}
            dwellSectionIndex={reviewDwellIndex}
            onReorderSections={reorderSections}
          />
        )}
        {step === "details" && (
          <DetailsScreen
            metadata={metadata}
            extras={extras}
            onMetadata={setMetadata}
            onExtras={setExtras}
            onContinue={goToGenerate}
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
          focusIdentity={settingsFocusIdentity}
        />
      )}

      {showGuide && (
        <KeywordGuide
          onClose={dismissOverlay}
          apiKeys={settings.apiKeys}
          onApiKeyChange={handleGuideApiKey}
        />
      )}

      {showIdentityPrompt && (
        <SheetShell
          onClose={() => setShowIdentityPrompt(false)}
          sheetClassName="sheet past-delete-sheet"
          aria-labelledby="identity-prompt-title"
        >
          {({ requestClose }) => (
            <>
              <h2 id="identity-prompt-title">Complete report details</h2>
              <p>
                Your name, company name, and website are required in the report
                header and cover. Add them in Settings, then continue to generate.
              </p>
              <div className="sheet-actions">
                <button type="button" className="btn" onClick={requestClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setShowIdentityPrompt(false);
                    openSettings({ focusIdentity: true });
                  }}
                >
                  Open Settings
                </button>
              </div>
            </>
          )}
        </SheetShell>
      )}

      {showBatchGuidancePrompt && (
        <SheetShell
          onClose={() => setShowBatchGuidancePrompt(false)}
          sheetClassName="sheet past-delete-sheet batch-guidance-sheet"
          aria-labelledby="batch-guidance-title"
        >
          {({ requestClose }) => (
            <>
              <h2 id="batch-guidance-title">Guidance for AI</h2>
              <p>
                Optional notes for the AI while it writes the flagged sections.
                This may not apply to every section — it will use it only where
                relevant.
              </p>
              <label className="field">
                <span>Overall guidance</span>
                <textarea
                  rows={5}
                  value={batchGuidanceDraft}
                  placeholder="e.g. Emphasise condensation risk in occupied rooms; avoid recommending external works the client cannot access…"
                  onChange={(e) => setBatchGuidanceDraft(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="sheet-actions">
                <button type="button" className="btn" onClick={requestClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void runAiForAllFlagged(batchGuidanceDraft)}
                >
                  Start AI
                </button>
              </div>
            </>
          )}
        </SheetShell>
      )}

      {pendingSourceMatch && (
        <SheetShell
          onClose={() => {
            if (!resumeBusy) setPendingSourceMatch(null);
          }}
          sheetClassName="sheet past-delete-sheet"
          aria-labelledby="resume-match-title"
          disableClose={resumeBusy}
        >
          {() => (
            <>
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
            </>
          )}
        </SheetShell>
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
