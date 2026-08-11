/** Past reports library: linked disk folder when available, else in-app storage. */

import {
  decodeReportProject,
  encodeReportProject,
  fingerprintSourceSections,
  PROJECT_EXT,
  PROJECT_MIME,
  projectFileNameFromDocx,
  type ReportProject
} from "./reportProject";

const DB_NAME = "survey-report-library";
const DB_VERSION = 1;
const HANDLE_KEY = "reports-directory";
const META_STORE = "meta";
const REPORT_STORE = "reports";

export type LibraryBackend = "folder" | "app";

export interface LibraryReportMeta {
  id: string;
  fileName: string;
  savedAt: number;
  propertyAddress: string;
  /** First line / short name of the property for tiles. */
  houseName: string;
  clientName: string;
  surveyDate: string;
  size: number;
  backend: LibraryBackend;
  /** JPEG thumb for the past-reports grid (front elevation when possible). */
  coverThumb?: Blob;
  /** True when a reopenable proprietary project is stored. */
  hasProject: boolean;
  /** Fingerprint of the source field-notes document, when known. */
  sourceFingerprint?: string;
}

export interface SaveReportInput {
  /** Finished Word report (written to linked folder and/or kept for download). */
  blob: Blob;
  /** Proprietary project snapshot for reopening design state. */
  projectBlob: Blob;
  fileName: string;
  propertyAddress?: string;
  houseName?: string;
  clientName?: string;
  surveyDate?: string;
  coverThumb?: Blob | null;
  sourceFingerprint?: string;
}

export interface SaveProjectDraftInput {
  /** Proprietary project snapshot for reopening design state. */
  projectBlob: Blob;
  fileName: string;
  propertyAddress?: string;
  houseName?: string;
  clientName?: string;
  surveyDate?: string;
  coverThumb?: Blob | null;
  sourceFingerprint?: string;
  /** Design step to reopen at (review or details). */
  step?: "review" | "details";
}

export interface SaveReportResult {
  id: string;
  backend: LibraryBackend;
  fileName: string;
  folderName?: string;
}

type LibraryRecord = LibraryReportMeta & {
  /** Finished .docx bytes (app storage, or cached copy). */
  blob?: Blob;
  /** Proprietary .dmsr project for reopen. */
  projectBlob?: Blob;
};

type DirectoryHandle = FileSystemDirectoryHandle;

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: "documents" | "downloads" | "desktop";
    }) => Promise<DirectoryHandle>;
  }
}

/** True when this browser can link a user-chosen folder (Chromium desktop, etc.). */
export function canLinkReportFolder(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  return typeof window.showDirectoryPicker === "function";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(REPORT_STORE)) {
        const store = db.createObjectStore(REPORT_STORE, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt");
      }
    };
  });
}

function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbSet(store: string, key: IDBValidKey, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function idbPutReport(record: LibraryRecord): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(REPORT_STORE, "readwrite");
        tx.objectStore(REPORT_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

async function getStoredDirectoryHandle(): Promise<DirectoryHandle | null> {
  if (!canLinkReportFolder()) return null;
  const handle = await idbGet<DirectoryHandle>(META_STORE, HANDLE_KEY);
  return handle ?? null;
}

async function ensureDirectoryPermission(
  handle: DirectoryHandle
): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  const probe = handle as DirectoryHandle & {
    queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof probe.queryPermission === "function") {
    let state = await probe.queryPermission(opts);
    if (state === "granted") return true;
    if (typeof probe.requestPermission === "function") {
      state = await probe.requestPermission(opts);
      return state === "granted";
    }
    return false;
  }
  return true;
}

/** Ask the user to pick a folder; stores the handle for later writes. */
export async function linkReportFolder(): Promise<string> {
  if (!canLinkReportFolder() || !window.showDirectoryPicker) {
    throw new Error("This device cannot link a reports folder.");
  }
  const handle = await window.showDirectoryPicker({
    id: "survey-reports",
    mode: "readwrite",
    startIn: "documents"
  });
  await idbSet(META_STORE, HANDLE_KEY, handle);
  return handle.name;
}

function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

export async function unlinkReportFolder(): Promise<void> {
  await idbDelete(META_STORE, HANDLE_KEY);
}

export async function getLinkedFolderName(): Promise<string | null> {
  const handle = await getStoredDirectoryHandle();
  if (!handle) return null;
  if (!(await ensureDirectoryPermission(handle))) return null;
  return handle.name;
}

export async function getLibraryBackend(): Promise<LibraryBackend> {
  if (!canLinkReportFolder()) return "app";
  const name = await getLinkedFolderName();
  return name ? "folder" : "app";
}

function newReportId(): string {
  return `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDocxExtension(name: string): string {
  const trimmed = name.trim() || "report.docx";
  return /\.docx$/i.test(trimmed) ? trimmed : `${trimmed}.docx`;
}

function titleWithoutExt(fileName: string): string {
  return (
    fileName.replace(/\.docx$/i, "").replace(/\.dmsr$/i, "").trim() || "report"
  );
}

/** Split "12 High Street (2)" → { base: "12 High Street", number: 2 }. */
function parseNumberedTitle(title: string): {
  base: string;
  number: number | null;
} {
  const m = title.match(/^(.*)\s+\((\d+)\)$/);
  if (m) return { base: m[1].trim() || "report", number: Number(m[2]) };
  return { base: title.trim() || "report", number: null };
}

function reportDetailsKey(d: {
  propertyAddress?: string;
  clientName?: string;
  surveyDate?: string;
  houseName?: string;
}): string {
  return [
    (d.propertyAddress ?? "").trim().toLowerCase(),
    (d.clientName ?? "").trim().toLowerCase(),
    (d.surveyDate ?? "").trim().toLowerCase(),
    (d.houseName ?? "").trim().toLowerCase()
  ].join("\0");
}

/**
 * When the library already has the same report name + property details,
 * return the next free "Name (2).docx", "Name (3).docx", …
 * Also avoids clashing with any existing file name.
 */
export function uniqueReportFileName(
  desiredFileName: string,
  existing: Array<
    Pick<
      LibraryReportMeta,
      "fileName" | "propertyAddress" | "clientName" | "surveyDate" | "houseName"
    >
  >,
  details: Pick<
    LibraryReportMeta,
    "propertyAddress" | "clientName" | "surveyDate" | "houseName"
  >
): string {
  const desired = ensureDocxExtension(desiredFileName);
  const { base } = parseNumberedTitle(titleWithoutExt(desired));
  const baseKey = base.toLowerCase();
  const detailsKey = reportDetailsKey(details);

  const taken = new Set(
    existing.map((r) => ensureDocxExtension(r.fileName).toLowerCase())
  );

  const sameNameAndDetails = existing.filter((r) => {
    if (reportDetailsKey(r) !== detailsKey) return false;
    const { base: otherBase } = parseNumberedTitle(titleWithoutExt(r.fileName));
    return otherBase.toLowerCase() === baseKey;
  });

  if (sameNameAndDetails.length === 0) {
    if (!taken.has(desired.toLowerCase())) return desired;
    let n = 2;
    for (;;) {
      const candidate = `${base} (${n}).docx`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
      n += 1;
    }
  }

  let maxN = 0;
  for (const r of sameNameAndDetails) {
    const { number } = parseNumberedTitle(titleWithoutExt(r.fileName));
    maxN = Math.max(maxN, number ?? 1);
  }

  let n = maxN + 1;
  for (;;) {
    const candidate = `${base} (${n}).docx`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    n += 1;
  }
}

async function writeBlobToDirectory(
  dir: DirectoryHandle,
  fileName: string,
  blob: Blob
): Promise<void> {
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function readBlobFromDirectory(
  dir: DirectoryHandle,
  fileName: string
): Promise<Blob | null> {
  try {
    const fileHandle = await dir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

function toMeta(record: LibraryRecord): LibraryReportMeta {
  const {
    blob: _blob,
    projectBlob: _projectBlob,
    ...rest
  } = record;
  return {
    ...rest,
    houseName: rest.houseName || "",
    clientName: rest.clientName || "",
    surveyDate: rest.surveyDate || "",
    hasProject: Boolean(record.projectBlob),
    ...(rest.sourceFingerprint
      ? { sourceFingerprint: rest.sourceFingerprint }
      : {})
  };
}

/**
 * Persist a finished report: Word file to the linked folder when available,
 * proprietary project always in app storage so Past reports can reopen design state.
 */
export async function saveReportToLibrary(
  input: SaveReportInput
): Promise<SaveReportResult> {
  const existing = await listLibraryReports();
  const propertyAddress = input.propertyAddress?.trim() || "";
  const houseName = input.houseName?.trim() || "";
  const clientName = input.clientName?.trim() || "";
  const surveyDate = input.surveyDate?.trim() || "";
  const fileName = uniqueReportFileName(input.fileName, existing, {
    propertyAddress,
    houseName,
    clientName,
    surveyDate
  });

  let projectBlob = input.projectBlob;
  const requestedName = ensureDocxExtension(input.fileName.trim() || "report.docx");
  if (fileName !== requestedName) {
    try {
      const project = await decodeReportProject(input.projectBlob);
      projectBlob = encodeReportProject({ ...project, fileName });
    } catch {
      // Keep the original project blob if it cannot be rewritten.
    }
  }

  const id = newReportId();
  const baseMeta: LibraryReportMeta = {
    id,
    fileName,
    savedAt: Date.now(),
    propertyAddress,
    houseName,
    clientName,
    surveyDate,
    size: input.blob.size,
    backend: "app",
    hasProject: true,
    ...(input.sourceFingerprint
      ? { sourceFingerprint: input.sourceFingerprint }
      : {}),
    ...(input.coverThumb ? { coverThumb: input.coverThumb } : {})
  };

  if (canLinkReportFolder()) {
    const dir = await getStoredDirectoryHandle();
    if (dir && (await ensureDirectoryPermission(dir))) {
      try {
        await writeBlobToDirectory(dir, fileName, input.blob);
        const meta: LibraryRecord = {
          ...baseMeta,
          backend: "folder",
          projectBlob
        };
        await idbPutReport(meta);
        return { id, backend: "folder", fileName, folderName: dir.name };
      } catch {
        // Permission lost or write failed — fall through to app storage.
      }
    }
  }

  await idbPutReport({
    ...baseMeta,
    blob: input.blob,
    projectBlob
  });
  return { id, backend: "app", fileName };
}

/**
 * Save design state mid-flow (no Word generate) so Past reports can reopen it.
 * Reuses an existing library entry when the same source fingerprint is already saved.
 */
export async function saveProjectDraftToLibrary(
  input: SaveProjectDraftInput
): Promise<SaveReportResult> {
  const existing = await listLibraryReports();
  const propertyAddress = input.propertyAddress?.trim() || "";
  const houseName = input.houseName?.trim() || "";
  const clientName = input.clientName?.trim() || "";
  const surveyDate = input.surveyDate?.trim() || "";

  let id = newReportId();
  let fileName = uniqueReportFileName(input.fileName, existing, {
    propertyAddress,
    houseName,
    clientName,
    surveyDate
  });
  let prev: LibraryRecord | undefined;

  if (input.sourceFingerprint) {
    const match = existing.find(
      (r) => r.hasProject && r.sourceFingerprint === input.sourceFingerprint
    );
    if (match) {
      id = match.id;
      fileName = match.fileName;
      prev = await idbGetReport(match.id);
    }
  }

  let projectBlob = input.projectBlob;
  try {
    const project = await decodeReportProject(input.projectBlob);
    projectBlob = encodeReportProject({
      ...project,
      fileName,
      step: input.step ?? project.step
    });
  } catch {
    // Keep the original project blob if it cannot be rewritten.
  }

  const baseMeta: LibraryReportMeta = {
    id,
    fileName,
    savedAt: Date.now(),
    propertyAddress,
    houseName,
    clientName,
    surveyDate,
    size: prev?.blob?.size ?? projectBlob.size,
    backend: prev?.backend ?? "app",
    hasProject: true,
    ...(input.sourceFingerprint
      ? { sourceFingerprint: input.sourceFingerprint }
      : prev?.sourceFingerprint
        ? { sourceFingerprint: prev.sourceFingerprint }
        : {}),
    ...(input.coverThumb
      ? { coverThumb: input.coverThumb }
      : prev?.coverThumb
        ? { coverThumb: prev.coverThumb }
        : {})
  };

  if (canLinkReportFolder()) {
    const dir = await getStoredDirectoryHandle();
    if (dir && (await ensureDirectoryPermission(dir))) {
      try {
        // Drafts store the reopenable project beside any existing Word copy.
        await writeBlobToDirectory(
          dir,
          projectFileNameFromDocx(fileName),
          projectBlob
        );
        const meta: LibraryRecord = {
          ...baseMeta,
          backend: "folder",
          ...(prev?.blob ? { blob: prev.blob } : {}),
          projectBlob
        };
        await idbPutReport(meta);
        return { id, backend: "folder", fileName, folderName: dir.name };
      } catch {
        // Permission lost or write failed — fall through to app storage.
      }
    }
  }

  await idbPutReport({
    ...baseMeta,
    backend: "app",
    ...(prev?.blob ? { blob: prev.blob } : {}),
    projectBlob
  });
  return { id, backend: "app", fileName };
}

export async function listLibraryReports(): Promise<LibraryReportMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE, "readonly");
    const req = tx.objectStore(REPORT_STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as LibraryRecord[]).map(toMeta);
      rows.sort((a, b) => b.savedAt - a.savedAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbGetReport(id: string): Promise<LibraryRecord | undefined> {
  return idbGet(REPORT_STORE, id);
}

/** Load the proprietary project for a past report (reopen design state). */
export async function loadLibraryProject(id: string): Promise<ReportProject> {
  const record = await idbGetReport(id);
  if (!record?.projectBlob) {
    throw new Error(
      "This report was saved before project reopen was available. Generate it again to keep a reopenable copy."
    );
  }
  return decodeReportProject(record.projectBlob);
}

/**
 * Find the newest saved project that came from the same field-notes source.
 * Falls back to decoding older projects that lack a stored fingerprint.
 */
export async function findLatestLibraryMatchBySource(
  fingerprint: string
): Promise<LibraryReportMeta | null> {
  if (!fingerprint) return null;
  const rows = await listLibraryReports();
  const withFp = rows.find(
    (r) => r.hasProject && r.sourceFingerprint === fingerprint
  );
  if (withFp) return withFp;

  for (const row of rows) {
    if (!row.hasProject || row.sourceFingerprint) continue;
    try {
      const project = await loadLibraryProject(row.id);
      const fp =
        project.sourceFingerprint ||
        (await fingerprintSourceSections(project.sections));
      if (fp === fingerprint) return row;
    } catch {
      // Skip unreadable entries.
    }
  }
  return null;
}

export interface LibraryExportFiles {
  /** Finished Word document when available. */
  docx: File | null;
  /** Proprietary project file when available. */
  project: File | null;
}

/** Resolve download/share payloads for a library entry. */
export async function getLibraryExportFiles(
  id: string
): Promise<LibraryExportFiles> {
  const record = await idbGetReport(id);
  if (!record) throw new Error("Report not found.");

  let docxBlob = record.blob ?? null;
  if (!docxBlob && record.backend === "folder") {
    const dir = await getStoredDirectoryHandle();
    if (dir && (await ensureDirectoryPermission(dir))) {
      docxBlob = await readBlobFromDirectory(dir, record.fileName);
    }
  }

  const docxName = record.fileName.replace(/\.dmsr$/i, "") || "report.docx";
  const resolvedDocxName = /\.docx$/i.test(docxName)
    ? docxName
    : `${docxName}.docx`;

  const docx = docxBlob
    ? new File([docxBlob], resolvedDocxName, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    : null;

  const projectName = projectFileNameFromDocx(resolvedDocxName);
  const project = record.projectBlob
    ? new File([record.projectBlob], projectName, { type: PROJECT_MIME })
    : null;

  return { docx, project };
}

/** Remove a report from the library index and, when possible, its file on disk. */
export async function deleteLibraryReport(id: string): Promise<void> {
  const record = await idbGetReport(id);
  if (!record) return;

  if (record.backend === "folder" && canLinkReportFolder()) {
    const dir = await getStoredDirectoryHandle();
    if (dir && (await ensureDirectoryPermission(dir))) {
      try {
        await dir.removeEntry(record.fileName);
      } catch {
        // File may already be gone or renamed — still drop the index entry.
      }
      try {
        await dir.removeEntry(projectFileNameFromDocx(record.fileName));
      } catch {
        // Optional project file on disk may not exist.
      }
    }
  }

  await idbDelete(REPORT_STORE, id);
}

export { PROJECT_EXT, PROJECT_MIME };
