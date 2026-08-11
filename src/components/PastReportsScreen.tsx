import { useEffect, useMemo, useState } from "react";
import {
  deleteLibraryReport,
  getLibraryExportFiles,
  listLibraryReports,
  loadLibraryProject,
  type LibraryReportMeta
} from "../lib/reportLibrary";
import type { ReportProject } from "../lib/reportProject";

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

function canShareFile(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (reports ? reports.filter((r) => reportMatchesQuery(r, query)) : []),
    [reports, query]
  );

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

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
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
      if (canShareFile(file) && navigator.share) {
        try {
          await navigator.share({ files: [file], title: file.name });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      downloadFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const downloadReport = async (report: LibraryReportMeta) => {
    if (busyId) return;
    setBusyId(report.id);
    setError(null);
    try {
      const { docx, project } = await getLibraryExportFiles(report.id);
      const file = docx ?? project;
      if (!file) {
        throw new Error("Nothing available to download for this report.");
      }
      downloadFile(file);
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
          Share or download the Word copy when available.
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
                  onDownload={downloadReport}
                  onRequestDelete={setPendingDelete}
                />
              ))}
            </div>
          )}
        </>
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
                className="btn danger"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
