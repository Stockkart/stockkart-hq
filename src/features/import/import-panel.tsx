"use client";

import { Upload } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS } from "@/lib/imports/constants";
import {
  type ColumnMapping,
  IMPORT_FIELD_HINTS,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  type ImportField,
  mappedFields,
  payloadRows,
  suggestMapping,
} from "@/lib/imports/fields";
import { fileSizeProblem, payloadTooLarge, prepareImport } from "@/lib/imports/prepare";
import {
  type ImportApplyResult,
  type ImportHistoryItem,
  type ImportPreview,
} from "@/lib/imports/views";
import { cn } from "@/lib/utils";
import { applyImportAction, previewImportAction } from "@/server/actions/imports";

type Step =
  | { kind: "pick" }
  | { kind: "map"; filename: string; headers: string[]; rows: string[][]; mapping: ColumnMapping }
  | {
      kind: "preview";
      filename: string;
      headers: string[];
      rows: string[][];
      mapping: ColumnMapping;
      fields: ImportField[];
      cells: string[][];
      preview: ImportPreview;
    }
  | { kind: "done"; result: ImportApplyResult; filename: string };

const STATUS_LABELS: Record<ImportHistoryItem["status"], string> = {
  previewed: "Previewed",
  applied: "Imported",
  failed: "Failed",
};

/** Long cells are shown cut in the preview (the server validates the full value). */
const shown = (value: string) => (value.length > 80 ? `${value.slice(0, 80)}…` : value);

/**
 * IMP-4 CSV import (the settings page's Import tab): pick a file (≤ 1 MB, read and parsed
 * here in the browser; the file itself is never uploaded or stored), map its columns, see
 * every row with its problems per cell, then import the valid rows in one go. Below: the
 * history of imports with their counts.
 */
export function ImportPanel({
  projectKey,
  history,
}: {
  projectKey: string;
  history: ImportHistoryItem[];
}) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { file: useId(), error: useId(), mapping: useId() };

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    // Size first, so a huge file is never read into memory.
    const tooBig = fileSizeProblem(file.size);
    if (tooBig) {
      setError(tooBig);
      return;
    }
    const prepared = prepareImport(await file.text(), file.size);
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    setStep({
      kind: "map",
      filename: file.name,
      headers: prepared.headers,
      rows: prepared.rows,
      mapping: suggestMapping(prepared.headers),
    });
  }

  function reset() {
    setStep({ kind: "pick" });
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function preview(current: Extract<Step, { kind: "map" | "preview" }>) {
    setError(null);
    if (current.mapping.title === undefined) {
      setError("Map a column to Title");
      return;
    }
    const fields = mappedFields(current.mapping);
    const cells = payloadRows(current.rows, current.mapping);
    const input = { projectKey, filename: current.filename, fields, rows: cells };
    if (payloadTooLarge(input)) {
      setError("This file is too large to import at once once its columns are mapped; split it");
      return;
    }
    startTransition(async () => {
      const result = await callAction(() => previewImportAction(input));
      if (!result) return;
      // State set after an await joins the transition only inside another startTransition.
      startTransition(() =>
        setStep({
          kind: "preview",
          filename: current.filename,
          headers: current.headers,
          rows: current.rows,
          mapping: current.mapping,
          fields,
          cells,
          preview: result,
        }),
      );
    });
  }

  function apply(current: Extract<Step, { kind: "preview" }>) {
    startTransition(async () => {
      const result = await callAction(() =>
        applyImportAction({
          importId: current.preview.importId,
          fields: current.fields,
          rows: current.cells,
        }),
      );
      if (!result) return;
      toast.success(
        result.alreadyApplied
          ? "This import was already applied; nothing new was created"
          : `Created ${result.created} ${result.created === 1 ? "issue" : "issues"}`,
      );
      startTransition(() => setStep({ kind: "done", result, filename: current.filename }));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="import-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="import-heading" className="text-lg font-medium">
            Import issues from CSV
          </h2>
          <p className="text-sm text-muted-foreground">
            Up to {IMPORT_MAX_ROWS} rows and {IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB. The first
            row names the columns: title (required), type, priority, status, assignee, labels,
            points, due_date, description. The file is read in your browser and not stored.
          </p>
        </div>

        {step.kind === "pick" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.file} className="text-sm font-medium">
              CSV file
            </label>
            <input
              id={ids.file}
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              aria-describedby={error ? ids.error : undefined}
              className="w-fit text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
          </div>
        ) : null}

        {step.kind === "map" || step.kind === "preview" ? (
          <MappingStep
            id={ids.mapping}
            filename={step.filename}
            rowCount={step.rows.length}
            headers={step.headers}
            mapping={step.mapping}
            pending={pending}
            onChange={(mapping) =>
              setStep({
                kind: "map",
                filename: step.filename,
                headers: step.headers,
                rows: step.rows,
                mapping,
              })
            }
            onPreview={() => preview(step)}
            onCancel={reset}
          />
        ) : null}

        <p
          id={ids.error}
          role="alert"
          aria-live="assertive"
          className="min-h-5 text-sm text-destructive"
        >
          {error}
        </p>

        {step.kind === "preview" ? (
          <PreviewStep step={step} pending={pending} onApply={() => apply(step)} />
        ) : null}

        {step.kind === "done" ? (
          <div role="status" className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <p>
              {step.result.alreadyApplied ? "Already imported: " : "Imported "}
              {step.filename}
              {step.result.firstKey && step.result.lastKey
                ? ` as ${step.result.firstKey}…${step.result.lastKey}`
                : ""}
              {step.result.skipped > 0 ? `; ${step.result.skipped} invalid rows skipped` : ""}.
            </p>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/${projectKey}/issues`}>Open the issue list</Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                Import another file
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <ImportHistory history={history} />
    </div>
  );
}

function MappingStep({
  id,
  filename,
  rowCount,
  headers,
  mapping,
  pending,
  onChange,
  onPreview,
  onCancel,
}: {
  id: string;
  filename: string;
  rowCount: number;
  headers: string[];
  mapping: ColumnMapping;
  pending: boolean;
  onChange: (mapping: ColumnMapping) => void;
  onPreview: () => void;
  onCancel: () => void;
}) {
  const columns = headers.map((header, index) => ({
    value: index,
    label: header || `Column ${index + 1}`,
    detail: `column ${index + 1}`,
  }));
  return (
    <fieldset aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border p-4">
      <legend id={id} className="px-1 text-sm font-medium">
        Map the columns of {filename} ({rowCount} {rowCount === 1 ? "row" : "rows"})
      </legend>
      <dl className="grid grid-cols-[8rem_minmax(0,16rem)_1fr] items-center gap-x-3 gap-y-2 text-sm">
        {IMPORT_FIELDS.map((field) => {
          const selectId = `${id}-${field}`;
          return (
            <div key={field} className="contents">
              <dt>
                <label htmlFor={selectId}>
                  {IMPORT_FIELD_LABELS[field]}
                  {field === "title" ? <span aria-hidden="true"> *</span> : null}
                </label>
              </dt>
              <dd>
                <Select
                  id={selectId}
                  label={IMPORT_FIELD_LABELS[field]}
                  value={mapping[field] ?? null}
                  options={columns}
                  clearLabel={field === "title" ? undefined : "Not imported"}
                  placeholder={field === "title" ? "Choose a column…" : "Not imported"}
                  onChange={(value) => {
                    const next: ColumnMapping = { ...mapping };
                    if (value === null) delete next[field];
                    else next[field] = value;
                    onChange(next);
                  }}
                />
              </dd>
              <dd className="text-xs text-muted-foreground">{IMPORT_FIELD_HINTS[field]}</dd>
            </div>
          );
        })}
      </dl>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={onPreview}>
          {pending ? "Checking…" : "Preview"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Choose another file
        </Button>
      </div>
    </fieldset>
  );
}

function PreviewStep({
  step,
  pending,
  onApply,
}: {
  step: Extract<Step, { kind: "preview" }>;
  pending: boolean;
  onApply: () => void;
}) {
  const { preview, fields, cells } = step;
  const errorsByRow = new Map<number, Map<ImportField, string[]>>();
  for (const error of preview.errors) {
    const row = errorsByRow.get(error.row) ?? new Map<ImportField, string[]>();
    row.set(error.field, [...(row.get(error.field) ?? []), error.message]);
    errorsByRow.set(error.row, row);
  }
  return (
    <section aria-labelledby="import-preview" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="import-preview" className="font-medium" aria-live="polite">
          {preview.validCount} valid · {preview.invalidCount} invalid
        </h3>
        <Button size="sm" disabled={pending || preview.validCount === 0} onClick={onApply}>
          <Upload aria-hidden="true" />
          {pending
            ? "Importing…"
            : `Import ${preview.validCount} ${preview.validCount === 1 ? "issue" : "issues"}`}
        </Button>
      </div>
      {preview.invalidCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          Invalid rows are skipped. Fix them in the file and import it again, or import the valid
          ones now.
        </p>
      ) : null}
      <div className="max-h-[32rem] overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Every row of the file with its problems; invalid cells are marked.
          </caption>
          <thead className="sticky top-0 border-b bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-14 px-3 py-2 font-medium">
                Row
              </th>
              {fields.map((field) => (
                <th key={field} scope="col" className="px-3 py-2 font-medium">
                  {IMPORT_FIELD_LABELS[field]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, index) => {
              const number = index + 2;
              const rowErrors = errorsByRow.get(number);
              return (
                <tr
                  key={number}
                  className={cn("border-b last:border-b-0", rowErrors && "bg-destructive/5")}
                >
                  <th scope="row" className="px-3 py-1.5 text-left font-normal tabular-nums">
                    <span aria-hidden="true">{number}</span>
                    <span className="sr-only">
                      {rowErrors ? `Row ${number}, invalid:` : `Row ${number}`}
                    </span>
                  </th>
                  {fields.map((field, column) => {
                    const messages = rowErrors?.get(field);
                    return (
                      <td
                        key={field}
                        className={cn(
                          "max-w-56 px-3 py-1.5 align-top",
                          messages && "text-destructive",
                        )}
                      >
                        <span className="block truncate">{shown(row[column] ?? "")}</span>
                        {messages ? (
                          <span className="block text-xs">
                            <span className="sr-only">Problem:</span> {messages.join("; ")}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ImportHistory({ history }: { history: ImportHistoryItem[] }) {
  return (
    <section aria-labelledby="import-history" className="flex flex-col gap-2">
      <h2 id="import-history" className="text-lg font-medium">
        Import history
      </h2>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No imports yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  File
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Rows
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Created
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Invalid
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  By
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <td className="max-w-64 truncate px-3 py-2">{item.filename}</td>
                  <td className="px-3 py-2">{STATUS_LABELS[item.status]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.rowCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.createdCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.errorCount}</td>
                  <td className="px-3 py-2">{item.createdByName ?? "A former user"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    <RelativeTime date={item.appliedAt ?? item.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
