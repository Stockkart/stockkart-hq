// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Combobox } from "./combobox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { MultiSelect, Select, type SelectOption } from "./select";

const statuses: SelectOption<string>[] = [
  { value: "todo", label: "Todo" },
  { value: "prog", label: "In Progress" },
  { value: "review", label: "In Review" },
  { value: "done", label: "Done" },
];

function StatusField({
  initial = "todo",
  options = statuses,
  clearLabel,
  onChange = () => {},
}: {
  initial?: string | null;
  options?: SelectOption<string>[];
  clearLabel?: string;
  onChange?: (value: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div>
      <label htmlFor="status">Status</label>
      <Select
        id="status"
        label="Status"
        value={value}
        options={options}
        clearLabel={clearLabel}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">After</button>
    </div>
  );
}

const trigger = () => screen.getByRole("combobox", { name: "Status" });
const activeOption = () => {
  const id = trigger().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};

describe("Select", () => {
  it("is a combobox labelled by its field label, controlling a listbox", async () => {
    const user = userEvent.setup();
    render(<StatusField />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveTextContent("Todo");
    await user.click(trigger());
    const listbox = screen.getByRole("listbox", { name: "Status" });
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", listbox.id);
    expect(within(listbox).getAllByRole("option")).toHaveLength(4);
    expect(within(listbox).getByRole("option", { name: "Todo" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(listbox).getByRole("option", { name: "Done" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // Focus stays on the trigger; the active option is its aria-activedescendant.
    expect(trigger()).toHaveFocus();
    expect(activeOption()).toHaveTextContent("Todo");
  });

  it.each(["{Enter}", " ", "{ArrowDown}"])("opens with %s", async (key) => {
    const user = userEvent.setup();
    render(<StatusField />);
    trigger().focus();
    await user.keyboard(key);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(activeOption()).toHaveTextContent("Todo");
  });

  it("moves with the arrows, Home and End, and picks with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusField onChange={onChange} />);
    trigger().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeOption()).toHaveTextContent("In Review");
    await user.keyboard("{ArrowUp}");
    expect(activeOption()).toHaveTextContent("In Progress");
    await user.keyboard("{End}");
    expect(activeOption()).toHaveTextContent("Done");
    await user.keyboard("{Home}");
    expect(activeOption()).toHaveTextContent("Todo");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("prog");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("In Progress");
    expect(trigger()).toHaveFocus();
  });

  it("jumps by type-ahead, cycling through options with the same first letter", async () => {
    const user = userEvent.setup();
    render(<StatusField />);
    trigger().focus();
    await user.keyboard("i");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(activeOption()).toHaveTextContent("In Progress");
    await user.keyboard("i");
    expect(activeOption()).toHaveTextContent("In Review");
    await user.keyboard("{Enter}");
    expect(trigger()).toHaveTextContent("In Review");
  });

  it("closes on Escape and returns focus to the trigger without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusField onChange={onChange} />);
    await user.click(trigger());
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on Tab and moves on", async () => {
    const user = userEvent.setup();
    render(<StatusField />);
    trigger().focus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("selects with the mouse", async () => {
    const user = userEvent.setup();
    render(<StatusField />);
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "Done" }));
    expect(trigger()).toHaveTextContent("Done");
  });

  it("offers a clear option for nullable fields", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusField clearLabel="None" onChange={onChange} />);
    await user.click(trigger());
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("None");
    await user.click(options[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(trigger()).toHaveTextContent("None");
  });

  it("adds a search field to long lists, filtering as you type", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `u${i}`, label: `User ${i}` }));
    many.push({ value: "ada", label: "Ada Lovelace" });
    render(<StatusField options={many} initial={null} clearLabel="Unassigned" />);
    trigger().focus();
    await user.keyboard("{Enter}");
    const search = screen.getByRole("combobox", { name: "Search Status" });
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("aria-autocomplete", "list");
    await user.keyboard("ada");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ada Lovelace",
    ]);
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Ada Lovelace" }).id,
    );
    await user.keyboard("{Enter}");
    expect(trigger()).toHaveTextContent("Ada Lovelace");
    expect(trigger()).toHaveFocus();
  });

  it("starts the search with a character typed on the trigger", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `u${i}`, label: `User ${i}` }));
    render(<StatusField options={many} initial={null} />);
    trigger().focus();
    await user.keyboard("1");
    expect(screen.getByRole("combobox", { name: "Search Status" })).toHaveValue("1");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "User 1",
      "User 10",
      "User 11",
    ]);
  });

  it("works inside a dialog: Escape closes the list, not the dialog", async () => {
    const user = userEvent.setup();
    const onDialogChange = vi.fn();
    render(
      <Dialog open onOpenChange={onDialogChange}>
        <DialogContent>
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>Form</DialogDescription>
          <StatusField />
        </DialogContent>
      </Dialog>,
    );
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "Done" }));
    expect(trigger()).toHaveTextContent("Done");
    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onDialogChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });
});

describe("MultiSelect", () => {
  const labels: SelectOption<string>[] = [
    { value: "l1", label: "backend" },
    { value: "l2", label: "frontend" },
  ];

  function LabelsField({ onCreate }: { onCreate?: (text: string) => void }) {
    const [value, setValue] = useState<string[]>(["l1"]);
    return (
      <MultiSelect
        aria-label="Labels"
        label="Labels"
        value={value}
        options={labels}
        onChange={(next) => setValue(next)}
        onCreate={onCreate}
      />
    );
  }

  it("toggles values with checkmarks and stays open", async () => {
    const user = userEvent.setup();
    render(<LabelsField />);
    const button = screen.getByRole("combobox", { name: "Labels" });
    expect(button).toHaveTextContent("backend");
    await user.click(button);
    const listbox = screen.getByRole("listbox", { name: "Labels" });
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    const frontend = within(listbox).getByRole("option", { name: "frontend" });
    expect(within(listbox).getAllByTestId("option-check")).toHaveLength(1);
    await user.click(frontend);
    expect(frontend).toHaveAttribute("aria-selected", "true");
    expect(within(listbox).getAllByTestId("option-check")).toHaveLength(2);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(button).toHaveTextContent("backend, frontend");
  });

  it("creates a new value from the search text", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<LabelsField onCreate={onCreate} />);
    await user.click(screen.getByRole("combobox", { name: "Labels" }));
    await user.keyboard("ocr");
    expect(screen.getByRole("option", { name: "Create “ocr”" })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledWith("ocr");
    // An existing name is offered as itself, not created again.
    await user.keyboard("Backend");
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();
  });
});

describe("Combobox (async)", () => {
  const adrs: SelectOption<string>[] = [
    { value: "a1", label: "0001. Use Postgres" },
    { value: "a2", label: "0002. Use Neon" },
    { value: "a3", label: "0003. Outbox" },
  ];

  it("loads on open, debounces typing, drops stale answers and picks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const resolvers: { query: string; resolve: (o: SelectOption<string>[]) => void }[] = [];
    const loadOptions = vi.fn(
      (query: string) =>
        new Promise<SelectOption<string>[]>((resolve) => resolvers.push({ query, resolve })),
    );
    render(
      <Combobox
        aria-label="Superseded by"
        label="Superseded by"
        value={null}
        onChange={onChange}
        loadOptions={loadOptions}
        debounceMs={50}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Superseded by" }));
    expect(loadOptions).toHaveBeenCalledWith("", expect.any(AbortSignal));
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    await act(async () => resolvers[0]?.resolve(adrs));
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await user.keyboard("neo");
    // One request for the pause after typing, not one per key.
    await waitFor(() => expect(loadOptions).toHaveBeenCalledTimes(2));
    expect(loadOptions).toHaveBeenLastCalledWith("neo", expect.any(AbortSignal));
    await act(async () => resolvers[1]?.resolve([adrs[1] as SelectOption<string>]));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["0002. Use Neon"]);
    // A late answer for an older query is ignored.
    await act(async () => resolvers[0]?.resolve(adrs));
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("a2", adrs[1]);
    expect(screen.getByRole("combobox", { name: "Superseded by" })).toHaveFocus();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        aria-label="Issue"
        label="Issue"
        value={null}
        onChange={() => {}}
        loadOptions={async () => []}
        debounceMs={10}
        emptyText="No issues found"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Issue" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No issues found"));
  });
});
