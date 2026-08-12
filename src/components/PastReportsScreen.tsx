import { useEffect, useMemo, useState } from "react";
import { PIP_FLASH_MS } from "../lib/pipTiming";
import {
  deleteLibraryReport,
  getLibraryExportFiles,
  listLibraryReports,
  loadLibraryProject,
  type LibraryReportMeta
} from "../lib/reportLibrary";
import { openReportPrintDialog } from "../lib/reportPrint";
import type { ReportProject } from "../lib/reportProject";
import {
  downloadFile,
  shareOrDownload,
  type ExportFormat,
  type ExportFormatOption
} from "../lib/webShare";
import ExportFormatSheet from "./ExportFormatSheet";

interface Props {
  onOpenProject: (project: ReportProject) => void;
}

function displayTitle(report: LibraryReportMeta): string {
  return (
    report.fileName.replace(/\.docx$/i, "").replace(/\.dmsr$/i, "") ||
    "Untitled report"
  );
}

function reportMatchesQuery(report: LibraryReportMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    displayTitle(report),
    report.fileName,
    report.surveyDate,
    report.clientName,
    report.houseName,
    report.propertyAddress
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

function formatDiskSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReportTile({
  report,
  busy,
  onOpen,
  onShare,
  onDownload,
  onRequestDelete
}: {
  report: LibraryReportMeta;
  busy: boolean;
  onOpen: (report: LibraryReportMeta) => void;
  onShare: (report: LibraryReportMeta) => void;
  onDownload: (report: LibraryReportMeta) => void;
  onRequestDelete: (report: LibraryReportMeta) => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!report.coverThumb) {
      setThumbUrl(null);
      return;
    }
    const url = URL.createObjectURL(report.coverThumb);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [report.coverThumb]);

  return (
    <article className="past-tile">
      <button
        type="button"
        className={`past-tile-hit${report.hasProject ? "" : " is-static"}`}
        disabled={busy || !report.hasProject}
        onClick={() => onOpen(report)}
        aria-label={
          report.hasProject
            ? `Open ${displayTitle(report)}`
            : `${displayTitle(report)} (cannot reopen design state)`
        }
      >
        <div className={`past-tile-media${thumbUrl ? "" : " is-empty"}`}>
          {thumbUrl ? (
            <img src={thumbUrl} alt="" draggable={false} />
          ) : (
            <span className="past-tile-placeholder">No photo</span>
          )}
        </div>
        <div className="past-tile-body">
          <h3 className="past-tile-title">{displayTitle(report)}</h3>
          <p className="past-tile-meta">
            {report.surveyDate || "Survey date unknown"}
          </p>
          <p className="past-tile-meta">
            {report.clientName || "Owner unknown"}
          </p>
          <p className="past-tile-meta">
            {report.houseName || report.propertyAddress || "Property unknown"}
          </p>
          <p className="past-tile-meta past-tile-size">
            {formatDiskSize(report.size)} on disk
          </p>
          {!report.hasProject && (
            <p className="past-tile-meta past-tile-note">
              Word copy only — reopen needs a newer save
            </p>
          )}
        </div>
      </button>
      <div className="past-tile-actions">
        <button
          type="button"
          className="btn tiny"
          disabled={busy}
          onClick={() => onShare(report)}
        >
          Share
        </button>
        <button
          type="button"
          className="btn tiny"
          disabled={busy}
          onClick={() => onDownload(report)}
        >
          Download
        </button>
        <button
          type="button"
          className="btn tiny danger"
          disabled={busy}
          onClick={() => onRequestDelete(report)}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

export default function PastReportsScreen({ onOpenProject }: Props) {
  const [reports, setReports] = useState<LibraryReportMeta[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LibraryReportMeta | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteFlash, setDeleteFlash] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadTarget, setDownloadTarget] =
    useState<LibraryReportMeta | null>(null);

  const filtered = useMemo(
    () => (reports ? reports.filter((r) => reportMatchesQuery(r, query)) : []),
    [reports, query]
  );

  const downloadOptions: ExportFormatOption[] = useMemo(() => {
    if (!downloadTarget) return [];
    return [
      {
        id: "docx",
        label: "Word (.docx)",
        hint: "Finished client report for Word / email",
        available: true
      },
      {
        id: "pdf",
        label: "PDF",
        hint: downloadTarget.hasProject
          ? "Opens print dialog — choose Save as PDF"
          : "Needs a reopenable project save",
        available: downloadTarget.hasProject
      },
      {
        id: "project",
        label: "Survey project (.dmsr)",
        hint: "Reopenable design file for this app",
        available: downloadTarget.hasProject
      }
    ];
  }, [downloadTarget]);

  useEffect(() => {
    let cancelled = false;
    void listLibraryReports()
      .then((rows) => {
        if (!cancelled) setReports(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setReports([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pendingDelete) {
      setDeleteArmed(false);
      setDeleteFlash(false);
      return;
    }
    setDeleteArmed(false);
    setDeleteFlash(false);
    const arm = window.setTimeout(() => {
      setDeleteArmed(true);
      setDeleteFlash(true);
      window.setTimeout(() => setDeleteFlash(false), PIP_FLASH_MS);
    }, 5000);
    return () => window.clearTimeout(arm);
  }, [pendingDelete]);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting || !deleteArmed) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteLibraryReport(pendingDelete.id);
      setReports((prev) =>
        prev ? prev.filter((r) => r.id !== pendingDelete.id) : prev
      );
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const openReport = async (report: LibraryReportMeta) => {
    if (!report.hasProject || busyId) return;
    setBusyId(report.id);
    setError(null);
    try {
      const project = await loadLibraryProject(report.id);
      onOpenProject(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const shareReport = async (report: LibraryReportMeta) => {
    if (busyId) return;
    setBusyId(report.id);
    setError(null);
    try {
      const { docx, project } = await getLibraryExportFiles(report.id);
      const file = docx ?? project;
      if (!file) {
        throw new Error("Nothing available to share for this report.");
      }
      await shareOrDownload(file, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const requestDownload = (report: LibraryReportMeta) => {
    if (busyId) return;
    setDownloadTarget(report);
  };

  const runDownload = async (format: ExportFormat) => {
    if (!downloadTarget || busyId) return;
    const report = downloadTarget;
    setBusyId(report.id);
    setError(null);
    try {
      if (format === "pdf") {
        if (!report.hasProject) {
          throw new Error("PDF needs a reopenable project save for this report.");
        }
        const project = await loadLibraryProject(report.id);
        openReportPrintDialog({
          sections: project.sections,
          metadata: project.metadata,
          extras: project.extras
        });
        setDownloadTarget(null);
        return;
      }

      const { docx, project } = await getLibraryExportFiles(report.id);
      const file =
        format === "project" ? project : format === "docx" ? docx : null;
      if (!file) {
        throw new Error(
          format === "project"
            ? "No project file available for this report."
            : "No Word copy available for this report."
        );
      }
      downloadFile(file);
      setDownloadTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="past-reports">
      <header className="past-reports-intro">
        <h2>Past reports</h2>
        <p className="muted">
          Tap a tile to reopen the survey design (sections, status, and options).
          Share opens your device share sheet when available; Download asks for a
          format.
        </p>
      </header>

      {error && <div className="banner error">{error}</div>}

      {reports === null && <p className="muted">Loading…</p>}

      {reports && reports.length === 0 && !error && (
        <p className="muted past-reports-empty">
          No saved reports yet. Generate a report to see it here.
        </p>
      )}

      {reports && reports.length > 0 && (
        <>
          <input
            type="search"
            className="search past-reports-search"
            placeholder="Search by name, owner, house, or date"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Search past reports"
          />

          {filtered.length === 0 ? (
            <p className="muted past-reports-empty">
              No reports match “{query.trim()}”.
            </p>
          ) : (
            <div className="past-reports-grid">
              {filtered.map((r) => (
                <ReportTile
                  key={r.id}
                  report={r}
                  busy={busyId === r.id || deleting}
                  onOpen={openReport}
                  onShare={shareReport}
                  onDownload={requestDownload}
                  onRequestDelete={setPendingDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      {downloadTarget && (
        <ExportFormatSheet
          options={downloadOptions}
          busy={busyId === downloadTarget.id}
          onPick={(format) => void runDownload(format)}
          onClose={() => setDownloadTarget(null)}
        />
      )}

      {pendingDelete && (
        <div
          className="sheet-backdrop"
          onClick={() => {
            if (!deleting) setPendingDelete(null);
          }}
        >
          <div
            className="sheet past-delete-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="past-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="past-delete-title">Delete report?</h2>
            <p>
              Remove{" "}
              <strong>{displayTitle(pendingDelete)}</strong> from past reports
              {pendingDelete.backend === "folder"
                ? " and delete the file from your linked folder if it’s still there"
                : " and from this app’s storage"}
              . This can’t be undone.
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn danger delete-confirm-btn${!deleteArmed && !deleting ? " is-arming" : ""}${deleteArmed ? " is-ready" : ""}${deleteFlash ? " is-flash" : ""}`}
                disabled={deleting || !deleteArmed}
                onClick={() => void confirmDelete()}
              >
                <span>{deleting ? "Deleting…" : "Delete"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
