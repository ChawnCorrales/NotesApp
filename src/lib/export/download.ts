/**
 * Handing a file to the browser.
 *
 * The only part of export that cannot exist on a server, kept apart from
 * everything that can. The service layer produces file contents; this turns
 * them into something the user has on disk.
 */

import { createZip, type ZipEntry } from "./zip";

/** Triggers a download of `blob` as `filename`. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Firefox will not follow a click on an element outside the document.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Released on the next tick: revoking synchronously can cancel the download
  // before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(filename: string, content: string): void {
  save(new Blob([content], { type: "text/markdown;charset=utf-8" }), filename);
}

export function downloadZip(filename: string, entries: ZipEntry[]): void {
  save(createZip(entries), filename);
}
