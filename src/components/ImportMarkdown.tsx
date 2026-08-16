"use client";

/**
 * Importing existing Markdown notes.
 *
 * Deliberately a single control with no configuration screen. §48 warns against
 * modal-heavy workflows, and there is nothing here the user should have to
 * decide up front — titles are inferred, and anything that needs correcting can
 * be corrected afterwards in the note itself.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { importMarkdownNotes, type ImportOutcome } from "@/lib/db/repositories";
import { registerImportTrigger } from "@/lib/import/import-trigger";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

const ACCEPTED = ".md,.markdown,.txt";

export function ImportMarkdown() {
  const { campaign, recognizer } = useCampaign();
  const { navigate } = useNavigation();

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  // Lets File ▸ Import Markdown open the same picker as the sidebar button.
  useEffect(() => registerImportTrigger(() => inputRef.current?.click()), []);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0 || !campaign) return;

      setBusy(true);
      setOutcome(null);
      try {
        const files = await Promise.all(
          Array.from(fileList).map(async (file) => ({
            name: file.name,
            content: await file.text(),
          })),
        );

        const result = await importMarkdownNotes(campaign.id, files, recognizer);
        setOutcome(result);

        // Opening the first note makes the import visibly real, rather than
        // leaving the user to hunt for what just happened.
        if (result.imported.length > 0) {
          navigate({ kind: "note", noteId: result.imported[0].id });
        }
      } finally {
        setBusy(false);
        // Allow re-importing the same file without picking a different one.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [campaign, recognizer, navigate],
  );

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        data-testid="import-markdown-input"
        onChange={(e) => void handleFiles(e.target.files)}
        className="hidden"
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-2 w-full rounded border border-hair px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:border-strong hover:text-ink disabled:opacity-50"
      >
        {busy ? "Importing…" : "Import Markdown"}
      </button>

      {outcome && (
        <div
          data-testid="import-summary"
          role="status"
          className="mt-2 rounded border border-hair px-2.5 py-1.5 text-xs"
        >
          <p className="text-ink-muted">
            Imported {outcome.imported.length}{" "}
            {outcome.imported.length === 1 ? "note" : "notes"}.
          </p>
          {outcome.failed.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-blood">
              {outcome.failed.map((failure) => (
                <li key={failure.name}>
                  {failure.name}: {failure.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
