import { type ImportStatus } from "./constants";
import { type ImportField } from "./fields";

/** IMP-4 read models passed to client components. Plain data only. */

/** What a preview returns: the import's id and every row's problems (row = spreadsheet row). */
export interface ImportPreview {
  importId: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  errors: { row: number; field: ImportField; message: string }[];
}

export interface ImportApplyResult {
  /** Issues created by this call (0 when the import had already been applied). */
  created: number;
  /** Rows skipped because they did not validate. */
  skipped: number;
  /** The import was applied before (a double submit): nothing was created now. */
  alreadyApplied: boolean;
  /** `STK-12`…`STK-40`, or null when nothing was created. */
  firstKey: string | null;
  lastKey: string | null;
}

/** A row of the import history. */
export interface ImportHistoryItem {
  id: string;
  filename: string;
  status: ImportStatus;
  rowCount: number;
  createdCount: number;
  errorCount: number;
  createdByName: string | null;
  createdAt: Date;
  appliedAt: Date | null;
}
