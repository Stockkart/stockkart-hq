/**
 * Line diff for the doc version-diff view (DOC-10 "diff of text"; the docs-UX slice renders
 * it). Isomorphic, pure and dependency-free: Myers' O((N+M)·D) shortest edit script over
 * lines, after trimming the common prefix and suffix, then grouped into hunks with context
 * collapsing.
 *
 * Bounded work: past `maxEdits` differing lines (default 2 000) the middle is reported as
 * one removal plus one addition instead of a minimal script, so a pathological pair of
 * versions cannot pin the CPU or memory (the trace is O(D²) numbers).
 */

export type LineDiffKind = "equal" | "add" | "remove";

export interface LineDiffHunk {
  kind: LineDiffKind;
  /** The hunk's lines joined with `\n` (no trailing newline). */
  text: string;
  /** Number of lines in the hunk. */
  lines: number;
  /** 1-based line of the hunk's first line in the old / new text. For an `add` hunk
   * `oldStart` is where it goes in the old text; for a `remove` hunk likewise `newStart`. */
  oldStart: number;
  newStart: number;
  /** Equal lines folded away by context collapsing ("12 unchanged lines"); `text` still
   * holds them, so the view can expand them. Only on `equal` hunks. */
  collapsed?: true;
}

export interface LineDiffOptions {
  /** Unchanged lines kept visible around each change (default 3). */
  context?: number;
  /** Edit distance beyond which the diff stops looking for a minimal script (default 2000). */
  maxEdits?: number;
}

interface LineOp {
  kind: LineDiffKind;
  text: string;
}

/** `\r\n` and `\r` read as `\n`; a final newline ends the last line rather than adding one. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Minimal edit script between two line arrays of ids (Myers), or null past `maxEdits`. */
function myers(a: Int32Array, b: Int32Array, maxEdits: number): LineOp["kind"][] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] = the V values of round d − 1 for k in [−(d − 1), d − 1].
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(d === 0 ? new Int32Array(0) : v.slice(offset - (d - 1), offset + d));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  const ops: LineOp["kind"][] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d] ?? new Int32Array(0);
    const at = (k: number) => previous[k + (d - 1)] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("equal");
      x -= 1;
      y -= 1;
    }
    ops.push(down ? "add" : "remove");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push("equal");
    x -= 1;
    y -= 1;
  }
  return ops.reverse();
}

/** Per-line edit script: every old line is `equal` or `remove`, every new one `equal` or `add`. */
export function diffLineOps(
  oldLines: readonly string[],
  newLines: readonly string[],
  maxEdits = 2000,
): LineOp[] {
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);

  // Compare small integers instead of strings.
  const ids = new Map<string, number>();
  const idOf = (line: string) => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = Int32Array.from(oldMiddle, idOf);
  const b = Int32Array.from(newMiddle, idOf);
  const script = myers(a, b, Math.max(0, maxEdits)) ?? [
    ...oldMiddle.map(() => "remove" as const),
    ...newMiddle.map(() => "add" as const),
  ];

  const ops: LineOp[] = oldLines.slice(0, prefix).map((text) => ({ kind: "equal", text }));
  let i = 0;
  let j = 0;
  for (const kind of script) {
    if (kind === "equal") {
      ops.push({ kind, text: oldMiddle[i] ?? "" });
      i += 1;
      j += 1;
    } else if (kind === "remove") {
      ops.push({ kind, text: oldMiddle[i] ?? "" });
      i += 1;
    } else {
      ops.push({ kind, text: newMiddle[j] ?? "" });
      j += 1;
    }
  }
  for (const text of oldLines.slice(oldLines.length - suffix)) ops.push({ kind: "equal", text });
  return ops;
}

/** Old text → new text as hunks; long unchanged runs are collapsed to `context` lines. */
export function lineDiff(
  oldText: string,
  newText: string,
  options: LineDiffOptions = {},
): LineDiffHunk[] {
  const context = Math.max(0, Math.floor(options.context ?? 3));
  const ops = diffLineOps(splitLines(oldText), splitLines(newText), options.maxEdits);

  // Group runs of one kind, tracking where each starts in both texts.
  const runs: { kind: LineDiffKind; lines: string[]; oldStart: number; newStart: number }[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    const last = runs.at(-1);
    if (last?.kind === op.kind) last.lines.push(op.text);
    else runs.push({ kind: op.kind, lines: [op.text], oldStart: oldLine, newStart: newLine });
    if (op.kind !== "add") oldLine += 1;
    if (op.kind !== "remove") newLine += 1;
  }

  const hunk = (
    kind: LineDiffKind,
    lines: string[],
    oldStart: number,
    newStart: number,
    collapsed = false,
  ): LineDiffHunk => ({
    kind,
    text: lines.join("\n"),
    lines: lines.length,
    oldStart,
    newStart,
    ...(collapsed ? { collapsed: true as const } : {}),
  });

  const out: LineDiffHunk[] = [];
  runs.forEach((run, index) => {
    if (run.kind !== "equal") {
      out.push(hunk(run.kind, run.lines, run.oldStart, run.newStart));
      return;
    }
    // Context is kept only next to a change: before it (lead) and after it (trail).
    const changeBefore = index > 0;
    const changeAfter = index < runs.length - 1;
    const keepStart = changeBefore ? context : 0;
    const keepEnd = changeAfter ? context : 0;
    if (run.lines.length <= keepStart + keepEnd) {
      out.push(hunk("equal", run.lines, run.oldStart, run.newStart));
      return;
    }
    const hiddenFrom = keepStart;
    const hiddenTo = run.lines.length - keepEnd;
    if (keepStart > 0) {
      out.push(hunk("equal", run.lines.slice(0, keepStart), run.oldStart, run.newStart));
    }
    out.push(
      hunk(
        "equal",
        run.lines.slice(hiddenFrom, hiddenTo),
        run.oldStart + hiddenFrom,
        run.newStart + hiddenFrom,
        true,
      ),
    );
    if (keepEnd > 0) {
      out.push(
        hunk("equal", run.lines.slice(hiddenTo), run.oldStart + hiddenTo, run.newStart + hiddenTo),
      );
    }
  });
  return out;
}
