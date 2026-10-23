// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IMPORT_MAX_FILE_BYTES } from "@/lib/imports/constants";

const actions = vi.hoisted(() => ({ previewImportAction: vi.fn(), applyImportAction: vi.fn() }));
vi.mock("@/server/actions/imports", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ImportPanel } = await import("./import-panel");

// jsdom's File has no `text()` yet (every browser has); read it the old way.
if (typeof Blob.prototype.text !== "function") {
  Object.defineProperty(Blob.prototype, "text", {
    configurable: true,
    value(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}

const IMPORT_ID = "0f1e2d3c-4b5a-4968-8776-5544332211aa";
const csv = '\uFEFFTitle,Priority,Story Points\r\n"Fix, quickly",P1,3\r\n,P9,x\r\n';

describe("ImportPanel (IMP-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.previewImportAction.mockResolvedValue({
      ok: true,
      data: {
        importId: IMPORT_ID,
        rowCount: 2,
        validCount: 1,
        invalidCount: 1,
        errors: [
          { row: 3, field: "title", message: "Title is required" },
          { row: 3, field: "priority", message: "Unknown priority “P9”; use P0–P3 or 0–3" },
        ],
      },
    });
    actions.applyImportAction.mockResolvedValue({
      ok: true,
      data: { created: 1, skipped: 1, alreadyApplied: false, firstKey: "STK-9", lastKey: "STK-9" },
    });
  });

  it("parses the file here, maps headers, previews per cell and applies the same cells", async () => {
    const user = userEvent.setup();
    render(<ImportPanel projectKey="STK" history={[]} />);
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File([csv], "issues.csv", { type: "text/csv" }),
    );

    // Mapping step: headers matched case-insensitively (aliases too).
    expect(await screen.findByRole("combobox", { name: "Title" })).toHaveTextContent("Title");
    expect(screen.getByRole("combobox", { name: "Points" })).toHaveTextContent("Story Points");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Not imported");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    const sent = {
      projectKey: "STK",
      filename: "issues.csv",
      fields: ["title", "priority", "points"],
      rows: [
        ["Fix, quickly", "P1", "3"],
        ["", "P9", "x"],
      ],
    };
    await waitFor(() => expect(actions.previewImportAction).toHaveBeenCalledWith(sent));
    expect(await screen.findByText("1 valid · 1 invalid")).toBeInTheDocument();
    const table = screen.getByRole("table");
    const invalidRow = within(table).getByRole("row", { name: /^Row 3, invalid:/ });
    expect(within(invalidRow).getByText(/Unknown priority/)).toBeInTheDocument();
    expect(within(invalidRow).getByText(/Title is required/)).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /^Row 2 Fix, quickly/ })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Import 1 issue" }));
    await waitFor(() =>
      expect(actions.applyImportAction).toHaveBeenCalledWith({
        importId: IMPORT_ID,
        fields: sent.fields,
        rows: sent.rows,
      }),
    );
    expect(await screen.findByText(/as STK-9…STK-9; 1 invalid rows skipped/)).toBeInTheDocument();
  });

  it("refuses a file over 1 MB before reading it", async () => {
    const user = userEvent.setup();
    render(<ImportPanel projectKey="STK" history={[]} />);
    const big = new File(["x".repeat(IMPORT_MAX_FILE_BYTES + 1)], "big.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV file"), big);
    expect(await screen.findByRole("alert")).toHaveTextContent(/limit is 1\.0 MB/);
    expect(actions.previewImportAction).not.toHaveBeenCalled();
  });

  it("requires Title to be mapped", async () => {
    const user = userEvent.setup();
    render(<ImportPanel projectKey="STK" history={[]} />);
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["Name,Type\nA,bug\n"], "no-title.csv", { type: "text/csv" }),
    );
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Map a column to Title");
    expect(actions.previewImportAction).not.toHaveBeenCalled();
  });

  it("lists the import history with counts", () => {
    render(
      <ImportPanel
        projectKey="STK"
        history={[
          {
            id: IMPORT_ID,
            filename: "old.csv",
            status: "applied",
            rowCount: 10,
            createdCount: 8,
            errorCount: 2,
            createdByName: "Ada",
            createdAt: new Date(),
            appliedAt: new Date(),
          },
        ]}
      />,
    );
    const row = screen.getByRole("row", { name: /old\.csv/ });
    expect(within(row).getByText("Imported")).toBeInTheDocument();
    expect(within(row).getByText("8")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
  });
});
