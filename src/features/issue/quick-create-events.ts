import { type IssueType } from "@/lib/issues/constants";

/**
 * Opens the app-wide quick-create dialog (ISS-4) from anywhere in the client: the ⌘K
 * palette's "Create issue / Create bug" and a todo's "Promote to issue" (MY-3). A window
 * event keeps the shell layout unchanged: the dialog lives in the top bar and listens.
 */

export const QUICK_CREATE_EVENT = "hq:quick-create";

export interface QuickCreateRequest {
  title?: string;
  type?: IssueType;
  /** MY-3: create through `promoteTodoAction`, linking this todo to the new issue. */
  promoteTodoId?: string;
  /** Called after the issue was created. */
  onCreated?: (issue: { id: string; number: number; key: string }) => void;
}

export function openQuickCreate(request: QuickCreateRequest = {}): void {
  window.dispatchEvent(
    new CustomEvent<QuickCreateRequest>(QUICK_CREATE_EVENT, { detail: request }),
  );
}

export function isQuickCreateEvent(event: Event): event is CustomEvent<QuickCreateRequest> {
  return (
    event instanceof CustomEvent &&
    event.type === QUICK_CREATE_EVENT &&
    typeof event.detail === "object" &&
    event.detail !== null
  );
}
