import { useCallback, useEffect, useMemo, useState } from "react";
import HomeScreen from "./components/HomeScreen";
import ReviewScreen from "./components/ReviewScreen";
import DetailsScreen from "./components/DetailsScreen";
import GenerateScreen from "./components/GenerateScreen";
import SettingsSheet from "./components/SettingsSheet";
import KeywordGuide from "./components/KeywordGuide";
import { parseShorthandDocx } from "./lib/docxParser";
import { matchEntries } from "./lib/matcher";
import { resolveSectionWithAi } from "./lib/claude";
import { activeAi, loadSettings, saveSettings, type AppSettings } from "./lib/settings";
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
  dampIssues: { risingDamp: false, penetratingDamp: false, condensation: false },
  recommendationIds: [],
  projectPlanLines: "",
  costLines: [],
  surveyDiscount: "",
  timeEstimate: "5-7 days"
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
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

  const flaggedCount = useMemo(
    () => sections.filter((s) => s.needsAttention).length,
    [sections]
  );

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
    try {
      const data = await file.arrayBuffer();
      const parsed = await parseShorthandDocx(data);
      setSections(matchEntries(parsed.entries));
      setWarnings(parsed.warnings);
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
      setError(null);
      try {
        const resolved = await resolveSectionWithAi(sections, index, ai);
        updateSection(index, resolved);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
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
    setError(null);
    // Work on a local copy so each resolution sees the previous results
    // (needed for cross-references), publishing progress as we go.
    let current = sections;
    const flagged = current
      .map((s, i) => (s.needsAttention ? i : -1))
      .filter((i) => i >= 0);
    let done = 0;
    for (const index of flagged) {
      done += 1;
      setBusy(
        `AI reviewing section ${current[index].entry.number} (${done}/${flagged.length})...`
      );
      setBusySectionIndex(index);
      try {
        const resolved = await resolveSectionWithAi(current, index, ai);
        current = current.map((s, i) => (i === index ? resolved : s));
        setSections(current);
      } catch (err) {
        setBusy(null);
        setBusySectionIndex(null);
        setError(
          `${err instanceof Error ? err.message : String(err)} - stopped; earlier sections were kept.`
        );
        return;
      }
    }
    setBusy(null);
    setBusySectionIndex(null);
  }, [sections, settings]);

  const reset = useCallback(() => {
    setSections([]);
    setWarnings([]);
    setExtras(defaultExtras);
    setMetadata(defaultMetadata(settings));
    setError(null);
    setStep("home");
  }, [settings]);

  return (
    <div className="app">
      <header className="topbar">
        {step !== "home" ? (
          <button
            className="topbar-btn"
            onClick={() =>
              setStep(step === "review" ? "home" : step === "details" ? "review" : "details")
            }
          >
            &#8249; Back
          </button>
        ) : (
          <span className="topbar-spacer" />
        )}
        <h1 className="topbar-title">
          {step === "home" && "Survey Reports"}
          {step === "review" && "Review sections"}
          {step === "details" && "Report details"}
          {step === "generate" && "Generate"}
        </h1>
        <button className="topbar-btn" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>

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
            onContinue={() => setStep("details")}
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
    </div>
  );
}
