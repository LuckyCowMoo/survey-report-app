import { useState } from "react";
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

export default function GenerateScreen({
  sections,
  metadata,
  extras,
  flaggedCount,
  onRestart
}: Props) {
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const issueCount = Object.values(extras.dampIssues).filter(Boolean).length;

  const generate = async () => {
    setError(null);
    setResult(null);
    try {
      const images = new Map<number, DocImage>();
      let done = 0;
      for (const s of sections) {
        done += 1;
        if (s.entry.images.length === 0) continue;
        setProgress(`Preparing photo ${done} of ${sections.length}...`);
        images.set(
          s.entry.number,
          await imageForDocument(s.entry.images[0], s.entry.imageNames[0])
        );
      }
      setProgress("Assembling document...");
      const blob = await generateReportBlob({ sections, metadata, extras, images });
      setResult({ blob, name: reportFileName(metadata) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const share = async () => {
    if (!result) return;
    const file = new File([result.blob], result.name, { type: DOCX_MIME });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: result.name });
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
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <div className="generate">
      <section className="panel">
        <h2>Ready to generate</h2>
        <ul className="summary-list">
          <li>
            <strong>{sections.length}</strong> photo sections
          </li>
          <li>
            <strong>{issueCount}</strong> damp issue explainer(s)
          </li>
          <li>
            <strong>{extras.recommendationIds.length}</strong> recommendation(s)
          </li>
          <li>
            <strong>{extras.costLines.length}</strong> cost line(s)
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

      {error && <div className="banner error">{error}</div>}
      {progress && <div className="banner busy">{progress}</div>}

      {!result ? (
        <button
          className="btn primary big"
          disabled={progress !== null}
          onClick={generate}
        >
          Generate report
        </button>
      ) : (
        <section className="panel success">
          <h2>Report ready</h2>
          <p>
            {result.name} ({(result.blob.size / 1024 / 1024).toFixed(1)} MB)
          </p>
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
