// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AttachmentView } from "@/lib/attachments/views";

import { type UploadFile } from "./upload-client";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
const deleteAttachmentAction = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/attachments", () => ({
  deleteAttachmentAction,
  startUploadAction: vi.fn(),
  confirmUploadAction: vi.fn(),
  cancelUploadAction: vi.fn(),
}));

const { AttachmentsPanel } = await import("./attachments-panel");

const ME = "me-0000";
const ISSUE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const target = { entityType: "issue", entityId: ISSUE } as const;

function item(id: string, overrides: Partial<AttachmentView> = {}): AttachmentView {
  return {
    id,
    entityType: "issue",
    entityId: ISSUE,
    filename: `${id}.png`,
    mime: "image/png",
    sizeBytes: 2048,
    width: 10,
    height: 10,
    uploadedBy: ME,
    uploaderName: "Me Myself",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const MINE = "11111111-2222-4333-8444-555555555555";
const THEIRS = "66666666-7777-4888-9999-aaaaaaaaaaaa";

describe("AttachmentsPanel (ISS-9)", () => {
  beforeEach(() => {
    toastError.mockReset();
    deleteAttachmentAction.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  const list = [
    item(MINE),
    item(THEIRS, { filename: "notes.pdf", mime: "application/pdf", uploadedBy: "someone" }),
  ];

  it("lists name, size, uploader, a download link, and delete only for the uploader", () => {
    render(
      <AttachmentsPanel
        target={target}
        attachments={list}
        currentUserId={ME}
        storageReady
        upload={vi.fn<UploadFile>()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Attachments (2)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `${MINE}.png` })).toHaveAttribute(
      "href",
      `/api/files/${MINE}?download=1`,
    );
    expect(screen.getByRole("link", { name: "Download notes.pdf" })).toHaveAttribute(
      "href",
      `/api/files/${THEIRS}?download=1`,
    );
    expect(screen.getAllByText(/2 KB · Me Myself/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: `Delete ${MINE}.png` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete notes.pdf" })).not.toBeInTheDocument();
  });

  it("deletes optimistically and rolls back when the server refuses", async () => {
    let refuse: (value: unknown) => void = () => undefined;
    deleteAttachmentAction.mockReturnValue(new Promise((resolve) => (refuse = resolve)));
    render(
      <AttachmentsPanel
        target={target}
        attachments={list}
        currentUserId={ME}
        storageReady
        upload={vi.fn<UploadFile>()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `Delete ${MINE}.png` }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: `${MINE}.png` })).not.toBeInTheDocument(),
    );
    expect(deleteAttachmentAction).toHaveBeenCalledWith({ attachmentId: MINE });
    await act(async () =>
      refuse({ ok: false, error: "Only the person who uploaded a file can delete it" }),
    );
    expect(await screen.findByRole("link", { name: `${MINE}.png` })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Only the person who uploaded a file can delete it");
  });

  it("uploads picked files and shows them", async () => {
    const upload = vi.fn<UploadFile>(async (file) => ({
      ok: true,
      data: item("99999999-2222-4333-8444-555555555555", { filename: file.name }),
    }));
    const { container } = render(
      <AttachmentsPanel
        target={target}
        attachments={[]}
        currentUserId={ME}
        storageReady
        upload={upload}
      />,
    );
    expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File(["x"], "report.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole("link", { name: "report.csv" })).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(file, target, expect.any(Object));
  });

  it("accepts files dropped on the drop zone", async () => {
    const upload = vi.fn<UploadFile>(async () => ({ ok: false, error: "Too many uploads" }));
    render(
      <AttachmentsPanel
        target={target}
        attachments={[]}
        currentUserId={ME}
        storageReady
        upload={upload}
      />,
    );
    const zone = screen.getByTestId("attachments-drop-zone");
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too many uploads"));
    expect(upload).toHaveBeenCalledWith(file, target, expect.any(Object));
  });

  it("explains that storage isn't set up, offers no upload, and still lists files", () => {
    render(
      <AttachmentsPanel
        target={target}
        attachments={list}
        currentUserId={ME}
        storageReady={false}
        upload={vi.fn<UploadFile>()}
      />,
    );
    expect(screen.getByText("File storage isn't set up yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach files" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("never renders a storage key or presigned URL into HTML", () => {
    const html = renderToStaticMarkup(
      <AttachmentsPanel target={target} attachments={list} currentUserId={ME} storageReady />,
    );
    expect(html).toContain(`/api/files/${MINE}`);
    expect(html).not.toMatch(/attachments\/[0-9a-f]|X-Amz|r2\.cloudflarestorage/);
  });
});
