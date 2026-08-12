import { useEffect, useMemo, useState } from "react";
import { generateReportBlob, reportFileName } from "../lib/docxGenerator";
import { imageForDocument, type DocImage } from "../lib/imageUtils";
import {
  canLinkReportFolder,
  getLinkedFolderName,
  linkReportFolder,
  saveReportToLibrary,
  type LibraryBackend,
  type SaveReportResult
} from "../lib/reportLibrary";
import { coverThumbnailBlob, houseNameFromAddress } from "../lib/reportCover";
import { openReportPrintDialog } from "../lib/reportPrint";
import {
  buildReportProject,
  encodeReportProject,
  fingerprintSourceSections,
  projectFileNameFromDocx,
  PROJECT_MIME
} from "../lib/reportProject";
import {
  downloadFile,
  shareOrDownload,
  type ExportFormat,
  type ExportFormatOption
} from "../lib/webShare";
import type { ReportExtras, ReportMetadata, SectionState } from "../types";
import ExportFormatSheet from "./ExportFormatSheet";

interface Props {
  sections: SectionState[];
  metadata: ReportMetadata;
  extras: ReportExtras;
  warnings?: string[];
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
  warnings = [],
  flaggedCount,
  onRestart
}: Props) {
  const recommendedName = reportFileName(metadata);
  const [fileName, setFileName] = useState(recommendedName);
  const [progress, setProgress] = useState<string | null>("Preparing report...");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const folderCapable = canLinkReportFolder();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [librarySave, setLibrarySave] = useState<SaveReportResult | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [showDownloadFormats, setShowDownloadFormats] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const issueCount = Object.values(extras.dampIssues).filter(Boolean).length;
  const recommendationCount =
    extras.recommendationIds.length + (extras.otherRecommendation ? 1 : 0);
  const costLineCount = extras.excludePlanCosts
    ? 0
    : extras.costLines.length + (extras.otherCost ? 1 : 0);

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
    void getLinkedFolderName().then((name) => {
      if (!cancelled) setFolderName(name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistToLibrary = async (blob: Blob, name: string) => {
    setLibraryBusy(true);
    setLibraryError(null);
    try {
      const coverThumb = await coverThumbnailBlob(sections);
      const sourceFingerprint = await fingerprintSourceSections(sections);
      const projectBlob = encodeReportProject(
        buildReportProject({
          sections,
          metadata,
          extras,
          warnings,
          fileName: name,
          step: "details",
          sourceFingerprint
        })
      );
      const saved = await saveReportToLibrary({
        blob,
        projectBlob,
        fileName: name,
        propertyAddress: metadata.propertyAddress,
        houseName: houseNameFromAddress(metadata.propertyAddress),
        clientName: metadata.clientName,
        surveyDate: metadata.surveyDate,
        coverThumb,
        sourceFingerprint
      });
      setLibrarySave(saved);
      if (saved.fileName && saved.fileName !== name) {
        setFileName(saved.fileName);
      }
      if (saved.backend === "folder" && saved.folderName) {
        setFolderName(saved.folderName);
      }
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLibraryBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setError(null);
      setResult(null);
      setLibrarySave(null);
      setLibraryError(null);
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
        setProgress("Saving to library...");
        await persistToLibrary(blob, name);
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
    setLibrarySave(null);
    setLibraryError(null);
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
      setProgress("Saving to library...");
      await persistToLibrary(blob, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const onLinkFolder = async () => {
    setLibraryError(null);
    setLibraryBusy(true);
    try {
      const name = await linkReportFolder();
      setFolderName(name);
      if (result) {
        await persistToLibrary(
          result.blob,
          resolveFileName(fileName, recommendedName)
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setLibraryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLibraryBusy(false);
    }
  };

  const downloadOptions: ExportFormatOption[] = useMemo(
    () => [
      {
        id: "docx",
        label: "Word (.docx)",
        hint: "Finished client report for Word / email",
        available: !!result
      },
      {
        id: "pdf",
        label: "PDF",
        hint: "Opens print dialog — choose Save as PDF",
        available: !!result
      },
      {
        id: "project",
        label: "Survey project (.dmsr)",
        hint: "Reopenable design file for this app",
        available: !!result
      }
    ],
    [result]
  );

  const buildProjectFile = (name: string): File => {
    const projectBlob = encodeReportProject(
      buildReportProject({
        sections,
        metadata,
        extras,
        warnings,
        fileName: name,
        step: "details"
      })
    );
    return new File([projectBlob], projectFileNameFromDocx(name), {
      type: PROJECT_MIME
    });
  };

  const share = async () => {
    if (!result) return;
    const name = resolveFileName(fileName, recommendedName);
    const file = new File([result.blob], name, { type: DOCX_MIME });
    setExportBusy(true);
    try {
      await shareOrDownload(file, name);
    } finally {
      setExportBusy(false);
    }
  };

  const runDownload = async (format: ExportFormat) => {
    if (!result) return;
    const name = resolveFileName(fileName, recommendedName);
    setExportBusy(true);
    setError(null);
    try {
      if (format === "pdf") {
        openReportPrintDialog({ sections, metadata, extras });
        setShowDownloadFormats(false);
        return;
      }
      if (format === "project") {
        downloadFile(buildProjectFile(name));
        setShowDownloadFormats(false);
        return;
      }
      downloadFile(new File([result.blob], name, { type: DOCX_MIME }));
      setShowDownloadFormats(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(false);
    }
  };

  const libraryStatus = (backend: LibraryBackend | null) => {
    if (libraryBusy && !librarySave) return "Saving to your report library…";
    if (libraryError) return `Library save failed: ${libraryError}`;
    if (!librarySave && !backend) return null;
    if (librarySave?.backend === "folder" || (backend === "folder" && folderName)) {
      return `Kept in your linked folder “${librarySave?.folderName ?? folderName}”.`;
    }
    return "Kept in this app’s storage as a reopenable project (plus a Word copy for share/download).";
  };

  const statusText = libraryStatus(librarySave?.backend ?? null);

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
            {extras.excludePlanCosts ? (
              <>
                Plan &amp; costs: <strong>excluded</strong>
              </>
            ) : (
              <>
                <strong>{costLineCount}</strong> cost line(s)
              </>
            )}
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
              onBlur={() => {
                const next = resolveFileName(fileName, recommendedName);
                setFileName(next);
                void persistToLibrary(result.blob, next);
              }}
            />
          </label>

          {statusText && (
            <p className={`library-status${libraryError ? " is-error" : ""}`}>
              {statusText}
            </p>
          )}

          <div className="result-actions">
            {folderCapable && !folderName && (
              <button
                type="button"
                className="btn big"
                disabled={libraryBusy}
                onClick={() => void onLinkFolder()}
              >
                Link a reports folder
              </button>
            )}

            {folderCapable && !folderName && (
              <p className="library-hint">
                Recommended on this device: choose one folder for finished
                reports so the app can keep track of them without downloading
                twice.
              </p>
            )}

            <button
              type="button"
              className="btn primary big"
              disabled={exportBusy}
              onClick={() => void share()}
            >
              Share
            </button>

            <button
              type="button"
              className="btn tiny download-copy"
              disabled={exportBusy}
              onClick={() => setShowDownloadFormats(true)}
            >
              Download a copy
            </button>
            <p className="download-copy-note">
              Not recommended — only if you need an extra file outside the
              library. Your report is already kept
              {folderName ? " in the linked folder" : " in app storage"}.
            </p>
          </div>
          <button className="btn small" onClick={onRestart}>
            Start a new report
          </button>
        </section>
      )}

      {showDownloadFormats && result && (
        <ExportFormatSheet
          options={downloadOptions}
          busy={exportBusy}
          onPick={(format) => void runDownload(format)}
          onClose={() => setShowDownloadFormats(false)}
        />
      )}
    </div>
  );
}
