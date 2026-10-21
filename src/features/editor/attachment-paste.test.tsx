// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type UploadFile } from "@/features/attachments/upload-client";
import { AttachmentUploadProvider } from "@/features/attachments/upload-context";
import { type ActionResult } from "@/lib/action-result";
import { type AttachmentView } from "@/lib/attachments/views";
import { type RichTextDoc } from "@/lib/rich-text";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
// The real upload client imports the server actions; the tests inject `upload` instead.
vi.mock("@/server/actions/attachments", () => ({
  startUploadAction: vi.fn(),
  confirmUploadAction: vi.fn(),
  cancelUploadAction: vi.fn(),
}));

const { RichTextEditor } = await import("./rich-text-editor");

const ISSUE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const IMAGE_ID = "11111111-2222-4333-8444-555555555555";
const FILE_ID = "66666666-7777-4888-9999-aaaaaaaaaaaa";

function view(overrides: Partial<AttachmentView>): AttachmentView {
  return {
    id: IMAGE_ID,
    entityType: "issue",
    entityId: ISSUE,
    filename: "shot.webp",
    mime: "image/webp",
    sizeBytes: 1000,
    width: 800,
    height: 600,
    uploadedBy: "me",
    uploaderName: "Me",
    createdAt: new Date(),
    ...overrides,
  };
}

/** A paste event as ProseMirror reads it (jsdom has no DataTransfer). */
function paste(target: Element, files: File[], text = "", html = "") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      types: files.length > 0 ? ["Files"] : ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? text : type === "text/html" ? html : ""),
    },
  });
  target.dispatchEvent(event);
  return event;
}

function setup(upload: UploadFile, options: { storageReady?: boolean; target?: boolean } = {}) {
  const docs: RichTextDoc[] = [];
  render(
    <AttachmentUploadProvider
      target={options.target === false ? null : { entityType: "issue", entityId: ISSUE }}
      storageReady={options.storageReady ?? true}
      upload={upload}
    >
      <RichTextEditor
        initialContent={null}
        onChange={(doc) => docs.push(doc)}
        projectKeys={["STK"]}
        label="Description"
      />
    </AttachmentUploadProvider>,
  );
  return { docs, last: () => docs.at(-1) };
}

describe("pasting files into the editor (ISS-9)", () => {
  beforeEach(() => toastError.mockReset());

  it("uploads a pasted image with a progress placeholder, then inserts an image node", async () => {
    let finish: (result: ActionResult<AttachmentView>) => void = () => undefined;
    const upload = vi.fn<UploadFile>(
      (_file, _target, options) =>
        new Promise((resolve) => {
          options?.onProgress?.(0.5);
          finish = resolve;
        }),
    );
    const { last } = setup(upload);
    const box = await screen.findByRole("textbox", { name: "Description" });
    const file = new File(["png"], "Screenshot.png", { type: "image/png" });
    act(() => {
      paste(box, [file]);
    });

    const progress = await screen.findByRole("progressbar", { name: "Uploading Screenshot.png" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toBe(file);
    expect(upload.mock.calls[0]?.[1]).toEqual({ entityType: "issue", entityId: ISSUE });
    expect(upload.mock.calls[0]?.[2]).toMatchObject({ draft: false });
    await waitFor(() => expect(progress).toHaveAttribute("value", "50"));

    await act(async () => finish({ ok: true, data: view({}) }));
    const img = await screen.findByRole("img", { name: "shot" });
    expect(img).toHaveAttribute("src", `/api/files/${IMAGE_ID}`);
    expect(img).toHaveAttribute("width", "800");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    const content = JSON.stringify(last());
    expect(content).toContain('"type":"image"');
    expect(content).toContain(`"attachmentId":"${IMAGE_ID}"`);
    expect(content).not.toContain("attachmentUpload");
  });

  it("inserts a file chip for a non-image file", async () => {
    const upload = vi.fn<UploadFile>(async () => ({
      ok: true,
      data: view({
        id: FILE_ID,
        filename: "server.log",
        mime: "text/plain; charset=utf-8",
        width: null,
        height: null,
        sizeBytes: 2048,
      }),
    }));
    const { last } = setup(upload);
    const box = await screen.findByRole("textbox", { name: "Description" });
    act(() => {
      paste(box, [new File(["log"], "server.log", { type: "text/plain" })]);
    });
    await waitFor(() => expect(box).toHaveTextContent("server.log (2 KB)"));
    expect(JSON.stringify(last())).toContain(
      `{"type":"fileAttachment","attrs":{"attachmentId":"${FILE_ID}","filename":"server.log","size":2048}}`,
    );
  });

  it("removes the placeholder and reports a failed upload", async () => {
    const upload = vi.fn<UploadFile>(async () => ({
      ok: false,
      error: "Files can be at most 10 MB",
    }));
    setup(upload);
    const box = await screen.findByRole("textbox", { name: "Description" });
    act(() => {
      paste(box, [new File(["x"], "big.png", { type: "image/png" })]);
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Files can be at most 10 MB"));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("leaves pasted text to the editor (rich text from office apps carries a picture too)", async () => {
    const upload = vi.fn<UploadFile>();
    setup(upload);
    const box = await screen.findByRole("textbox", { name: "Description" });
    act(() => {
      paste(box, [new File(["x"], "cells.png", { type: "image/png" })], "A1 B1");
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("says storage isn't set up yet instead of uploading", async () => {
    const upload = vi.fn<UploadFile>();
    setup(upload, { storageReady: false });
    const box = await screen.findByRole("textbox", { name: "Description" });
    act(() => {
      paste(box, [new File(["x"], "a.png", { type: "image/png" })]);
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("File storage isn't set up yet"));
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("asks to save first when the editor has no upload target", async () => {
    const upload = vi.fn<UploadFile>();
    setup(upload, { target: false });
    const box = await screen.findByRole("textbox", { name: "Description" });
    act(() => {
      paste(box, [new File(["x"], "a.png", { type: "image/png" })]);
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Save first, then attach files"));
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps images and file chips copied between HQ editors, never foreign images", async () => {
    const { last } = setup(vi.fn<UploadFile>());
    const box = await screen.findByRole("textbox", { name: "Description" });
    const html =
      `<div data-type="image" data-attachment-id="${IMAGE_ID}" data-alt="Chart" data-width="10" data-height="20"></div>` +
      `<p>See <span data-type="fileAttachment" data-attachment-id="${FILE_ID}" data-filename="a.log" data-size="5">a.log</span></p>` +
      `<img src="https://evil.test/x.png"><div data-type="image" data-attachment-id="../backups/x"></div>`;
    act(() => {
      paste(box, [], "Chart See a.log", html);
    });
    await waitFor(() => expect(JSON.stringify(last())).toContain(IMAGE_ID));
    const content = JSON.stringify(last());
    expect(content).toContain(
      `{"type":"image","attrs":{"attachmentId":"${IMAGE_ID}","alt":"Chart","width":10,"height":20}}`,
    );
    expect(content).toContain(
      `{"type":"fileAttachment","attrs":{"attachmentId":"${FILE_ID}","filename":"a.log","size":5}}`,
    );
    expect(content).not.toContain("evil.test");
    expect(content).not.toContain("backups");
  });

  it("offers an Attach file toolbar button (the keyboard alternative to dropping)", async () => {
    setup(vi.fn<UploadFile>());
    expect(await screen.findByRole("button", { name: "Attach file" })).toBeInTheDocument();
    // Drop is handled by the same plugin; jsdom has no layout for coordinates.
    fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
  });
});
