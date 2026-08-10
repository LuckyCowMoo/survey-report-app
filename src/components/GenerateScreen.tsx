import { useEffect, useState } from "react";
import { generateReportBlob, reportFileName } from "../lib/docxGenerator";
import { imageForDocument, type DocImage } from "../lib/imageUtils";
import type { ReportExtras, ReportMetadata, SectionState } from "../types";

interface Props {
  sections: SectionState[];
  metadata: ReportMetadata;
  extras: ReportExtras;
  flaggedCount: number;
  onRestart: () => void;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Ensure a usable .docx file name, falling back to the recommended name. */
function resolveFileName(value: string, fallback: string): string {
  const trimmed = value.trim() || fallback;
  return /\.docx$/i.test(trimmed) ? trimmed : `${trimmed}.docx`;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export default function GenerateScreen({
  sections,
  metadata,
  extras,
  flaggedCount,
  onRestart
}: Props) {
  const recommendedName = reportFileName(metadata);
  const [fileName, setFileName] = useState(recommendedName);
  const [progress, setProgress] = useState<string | null>("Preparing report...");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const issueCount = Object.values(extras.dampIssues).filter(Boolean).length;
  const recommendationCount =
    extras.recommendationIds.length + (extras.otherRecommendation ? 1 : 0);
  const costLineCount = extras.costLines.length + (extras.otherCost ? 1 : 0);

  useEffect(() => {
    setFileName((prev) => {
      const prevResolved = resolveFileName(prev, recommendedName);
      if (
        prevResolved === recommendedName ||
        prev.trim() === "" ||
        /^Damp and Timber Survey - .+\.docx$/i.test(prevResolved)
      ) {
        return recommendedName;
      }
      return prev;
    });
  }, [recommendedName]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setError(null);
      setResult(null);
      const name = resolveFileName(recommendedName, recommendedName);
      setFileName(name);
      try {
        const images = new Map<number, DocImage>();
        let done = 0;
        for (const s of sections) {
          if (cancelled) return;
          done += 1;
          if (s.entry.images.length === 0) continue;
          setProgress(`Preparing photo ${done} of ${sections.length}...`);
          // Let React paint the progress line before the next heavy encode.
          await yieldToUi();
          if (cancelled) return;
          images.set(
            s.entry.number,
            await imageForDocument(s.entry.images[0], s.entry.imageNames[0])
          );
          await yieldToUi();
        }
        if (cancelled) return;
        setProgress("Assembling document...");
        await yieldToUi();
        if (cancelled) return;
        const blob = await generateReportBlob({ sections, metadata, extras, images });
        if (cancelled) return;
        setResult({ blob, name });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setProgress(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // Generate once on enter — inputs are fixed for this visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    setError(null);
    setResult(null);
    const name = resolveFileName(fileName, recommendedName);
    setFileName(name);
    setProgress("Preparing report...");
    try {
      const images = new Map<number, DocImage>();
      let done = 0;
      for (const s of sections) {
        done += 1;
        if (s.entry.images.length === 0) continue;
        setProgress(`Preparing photo ${done} of ${sections.length}...`);
        await yieldToUi();
        images.set(
          s.entry.number,
          await imageForDocument(s.entry.images[0], s.entry.imageNames[0])
        );
        await yieldToUi();
      }
      setProgress("Assembling document...");
      await yieldToUi();
      const blob = await generateReportBlob({ sections, metadata, extras, images });
      setResult({ blob, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const share = async () => {
    if (!result) return;
    const name = resolveFileName(fileName, recommendedName);
    const file = new File([result.blob], name, { type: DOCX_MIME });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        // User cancelled the share sheet - not an error.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    download();
  };

  const download = () => {
    if (!result) return;
    const name = resolveFileName(fileName, recommendedName);
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <div className="generate">
      <section className="panel">
        <h2>Report summary</h2>
        <ul className="summary-list">
          <li>
            <strong>{sections.length}</strong> photo sections
          </li>
          <li>
            <strong>{issueCount}</strong> damp issue explainer(s)
          </li>
          <li>
            <strong>{recommendationCount}</strong> recommendation(s)
          </li>
          <li>
            <strong>{costLineCount}</strong> cost line(s)
          </li>
          <li>
            Property: <strong>{metadata.propertyAddress || "(address not set)"}</strong>
          </li>
        </ul>
        {flaggedCount > 0 && (
          <p className="warn-text">
            {flaggedCount} section(s) are still marked "needs attention" and
            will appear in the report as they stand. Go back to review them if
            needed.
          </p>
        )}
        {!metadata.propertyAddress && (
          <p className="warn-text">The property address is empty.</p>
        )}
      </section>

      {error && (
        <div className="banner error">
          {error}
          <button className="btn small" onClick={retry} style={{ marginLeft: 10 }}>
            Retry
          </button>
        </div>
      )}
      {progress && <div className="banner busy">{progress}</div>}

      {result && (
        <section className="panel success">
          <h2>Report ready</h2>
          <p>{(result.blob.size / 1024 / 1024).toFixed(1)} MB</p>
          <label className="field file-name-field">
            <span>Document name</span>
            <input
              type="text"
              value={fileName}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setFileName(e.target.value)}
              onBlur={() => setFileName(resolveFileName(fileName, recommendedName))}
            />
          </label>
          <div className="result-actions">
            <button className="btn primary big" onClick={share}>
              Share / save
            </button>
            <button className="btn big" onClick={download}>
              Download
            </button>
          </div>
          <button className="btn small" onClick={onRestart}>
            Start a new report
          </button>
        </section>
      )}
    </div>
  );
}
