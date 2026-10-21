// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";
import { type MentionUser } from "@/lib/notifications/views";

import { RichTextEditor } from "../rich-text-editor";

import { resetMentionUsersCache } from "./mention-users";

const USERS: MentionUser[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "Ada Lovelace",
    email: "ada@example.test",
    avatarUrl: null,
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    name: "Alan Turing",
    email: "alan@example.test",
    avatarUrl: null,
  },
  {
    id: "cccccccc-0000-4000-8000-000000000003",
    name: "Grace Hopper",
    email: "grace@example.test",
    avatarUrl: null,
  },
];

const listMentionUsersAction = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/watchers", () => ({ listMentionUsersAction }));

// jsdom has no layout: give ranges (caret coordinates) an empty box.
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => {
    const list: DOMRect[] = [];
    return Object.assign(list, { item: (index: number) => list[index] ?? null });
  };
}

async function setup() {
  const onChange = vi.fn<(doc: RichTextDoc) => void>();
  render(
    <RichTextEditor
      initialContent={null}
      onChange={onChange}
      projectKeys={["STK"]}
      label="Comment"
      variant="comment"
    />,
  );
  const box = await screen.findByRole("textbox", { name: "Comment" });
  if (!("editor" in box) || !(box.editor instanceof Editor)) throw new Error("no editor");
  const editor = box.editor;
  // Async act: the suggestion loads its items and renders its portal after a tick.
  const type = (text: string) =>
    act(async () => {
      editor.chain().focus().insertContent(text).run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const key = (name: string) =>
    act(async () => {
      fireEvent.keyDown(box, { key: name });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  return { box, editor, onChange, type, key };
}

const options = (listbox: HTMLElement) => within(listbox).getAllByRole("option");

describe("@mention suggestions (ISS-7, DOC-9)", () => {
  beforeEach(() => {
    resetMentionUsersCache();
    listMentionUsersAction.mockReset().mockResolvedValue({ ok: true, data: USERS });
  });

  it("opens on @, filters as you type, and moves with the arrow keys", async () => {
    const { box, type } = await setup();
    await type("@");
    const listbox = await screen.findByRole("listbox", { name: "Mention someone" });
    expect(options(listbox)).toHaveLength(3);
    expect(box).toHaveAttribute("aria-controls", listbox.id);

    await type("a");
    // "a" matches all three (names or emails); names starting with it first.
    await waitFor(() =>
      expect(options(listbox).map((option) => option.textContent)).toEqual([
        expect.stringContaining("Ada Lovelace"),
        expect.stringContaining("Alan Turing"),
        expect.stringContaining("Grace Hopper"),
      ]),
    );
    await type("l");
    await waitFor(() => expect(options(listbox)).toHaveLength(1));
    expect(options(listbox)[0]).toHaveTextContent("Alan Turing");
    expect(options(listbox)[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options(listbox)[0]?.id);
    // The list is loaded once, not per keystroke.
    expect(listMentionUsersAction).toHaveBeenCalledTimes(1);
  });

  it("wraps with Down/Up and inserts the active person on Enter", async () => {
    const { box, onChange, type, key } = await setup();
    await type("@");
    const listbox = await screen.findByRole("listbox", { name: "Mention someone" });
    await waitFor(() => expect(options(listbox)).toHaveLength(3));
    await key("ArrowDown");
    expect(options(listbox)[1]).toHaveAttribute("aria-selected", "true");
    await key("ArrowUp");
    await key("ArrowUp");
    expect(options(listbox)[2]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options(listbox)[2]?.id);

    await key("Enter");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(box).not.toHaveAttribute("aria-activedescendant");
    const doc = onChange.mock.calls.at(-1)?.[0];
    expect(doc?.content?.[0]?.content?.[0]).toMatchObject({
      type: "mention",
      attrs: { id: USERS[2]?.id, label: "Grace Hopper" },
    });
    expect(box.querySelector('[data-type="mention"]')).toHaveTextContent("@Grace Hopper");
  });

  it("closes on Escape without inserting anything", async () => {
    const { box, onChange, type, key } = await setup();
    await type("@gr");
    const listbox = await screen.findByRole("listbox", { name: "Mention someone" });
    await waitFor(() => expect(options(listbox)).toHaveLength(1));
    await key("Escape");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(box).not.toHaveAttribute("aria-controls");
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).not.toContain('"mention"');
  });

  it("says so when nobody matches, and Enter then does not pick anything", async () => {
    const { type, key, onChange } = await setup();
    await type("@zzz");
    expect(await screen.findByRole("status")).toHaveTextContent("No matching people");
    await key("Enter");
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).not.toContain('"mention"');
  });
});
