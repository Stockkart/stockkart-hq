// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";

import { RichTextView } from "../rich-text-view";

const ID = "11111111-2222-4333-8444-555555555555";

const doc = (...content: NonNullable<RichTextDoc["content"]>): RichTextDoc => ({
  type: "doc",
  content,
});

describe("attachment renderers (ISS-9, S-5)", () => {
  it("renders an image through /api/files, lazy, with its box reserved", () => {
    render(
      <RichTextView
        projectKeys={[]}
        doc={doc({
          type: "image",
          attrs: { attachmentId: ID, alt: "Login screen", width: 1280, height: 720 },
        })}
      />,
    );
    const img = screen.getByRole("img", { name: "Login screen" });
    expect(img).toHaveAttribute("src", `/api/files/${ID}`);
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "1280");
    expect(img).toHaveAttribute("height", "720");
  });

  it("opens the full-size image in an accessible dialog", async () => {
    render(
      <RichTextView
        projectKeys={[]}
        doc={doc({
          type: "image",
          attrs: { attachmentId: ID, alt: "Chart", width: 10, height: 10 },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View full size: Chart" }));
    const dialog = await screen.findByRole("dialog", { name: "Chart" });
    expect(dialog.querySelector("img")).toHaveAttribute("src", `/api/files/${ID}`);
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      `/api/files/${ID}?download=1`,
    );
  });

  it("renders a file chip as a download link", () => {
    render(
      <RichTextView
        projectKeys={[]}
        doc={doc({
          type: "paragraph",
          content: [
            {
              type: "fileAttachment",
              attrs: { attachmentId: ID, filename: "app.log", size: 2048 },
            },
          ],
        })}
      />,
    );
    const link = screen.getByRole("link", { name: /app\.log/ });
    expect(link).toHaveAttribute("href", `/api/files/${ID}?download=1`);
    expect(link).toHaveTextContent("(2 KB)");
  });

  it("renders nothing for a node whose id is not a uuid", () => {
    const html = renderToStaticMarkup(
      <RichTextView
        projectKeys={[]}
        doc={doc(
          { type: "paragraph", content: [{ type: "text", text: "x" }] },
          { type: "image", attrs: { attachmentId: "https://evil.test/a.png", alt: "a" } },
          {
            type: "paragraph",
            content: [{ type: "fileAttachment", attrs: { attachmentId: "../backups/db" } }],
          },
        )}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("backups");
  });

  it("never puts a storage key or a presigned URL into server HTML", () => {
    const html = renderToStaticMarkup(
      <RichTextView
        projectKeys={[]}
        doc={doc({
          type: "image",
          attrs: { attachmentId: ID, alt: "a", width: 1, height: 1, storageKey: "attachments/x" },
        })}
      />,
    );
    expect(html).toContain(`src="/api/files/${ID}"`);
    expect(html).not.toMatch(/attachments\/|r2\.cloudflarestorage|X-Amz/);
  });
});
