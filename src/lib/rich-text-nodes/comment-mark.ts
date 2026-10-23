import { type PlainTextRules } from "./types";

/**
 * DOC-13 `commentAnchor` is a MARK, not a node: `extractPlainText` keeps the marked text
 * as it is and ignores the mark itself (only `code` marks change plain text), so search,
 * `STK-123` extraction and Markdown export are unchanged by inline comments. Nothing to
 * register; listed in `rich-text-nodes/index.ts` so the registry shows every editor
 * feature (tested in `lib/doc-comments/anchors.test.ts` and `renderers/comment-mark.test.tsx`).
 */
export const commentAnchorPlainText: PlainTextRules = {};
