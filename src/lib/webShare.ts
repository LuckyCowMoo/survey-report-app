import JSZip from "jszip";

/** Trigger a same-tab download of a File/Blob. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function canShareFiles(files: File[]): boolean {
  try {
    return !!navigator.canShare?.({ files });
  } catch {
    return false;
  }
}

function withMime(file: File, type: string): File {
  if (file.type === type) return file;
  return new File([file], file.name, { type });
}

/** Wrap one or more files in a .zip (Android Chrome shares ZIP reliably). */
async function zipFiles(files: File[], zipName: string): Promise<File> {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.name, f);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const name = zipName.toLowerCase().endsWith(".zip")
    ? zipName
    : `${zipName.replace(/\.[^.]+$/, "") || "report"}.zip`;
  return new File([blob], name, { type: "application/zip" });
}

function zipNameFrom(file: File): string {
  return file.name.replace(/\.[^.]+$/, "") || "report";
}

/**
 * Open the OS share sheet when possible. Word MIME is often rejected by
 * Android Chrome `canShare`, so we retry as octet-stream and as a ZIP.
 * Returns true if the share UI was shown (including user cancel).
 */
export async function shareFile(file: File, title?: string): Promise<boolean> {
  if (!navigator.share) return false;

  const tryShare = async (files: File[]) => {
    await navigator.share({
      files,
      title: title ?? files[0]?.name
    });
  };

  const candidates: File[] = [file];
  if (file.type && file.type !== "application/octet-stream") {
    candidates.push(withMime(file, "application/octet-stream"));
  }

  for (const candidate of candidates) {
    if (!canShareFiles([candidate])) continue;
    try {
      await tryShare([candidate]);
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return true;
    }
  }

  // Some browsers lie in canShare — still attempt a direct share once.
  try {
    await tryShare([file]);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return true;
  }

  try {
    const zipped = await zipFiles([file], zipNameFrom(file));
    await tryShare([zipped]);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return true;
  }

  return false;
}

/** Share with download fallback when Web Share cannot open. */
export async function shareOrDownload(file: File, title?: string): Promise<void> {
  const shared = await shareFile(file, title);
  if (!shared) downloadFile(file);
}

export type ExportFormat = "docx" | "pdf" | "project";

export interface ExportFormatOption {
  id: ExportFormat;
  label: string;
  hint: string;
  available: boolean;
}
