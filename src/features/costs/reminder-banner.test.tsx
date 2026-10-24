// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CostReminderBanner } from "./reminder-banner";

describe("CostReminderBanner (COST-7 fallback without the cron)", () => {
  it("says which month is incomplete and links to it", () => {
    render(
      <CostReminderBanner
        projectKey="STK"
        reminder={{ projectKey: "STK", month: "2026-10", missingCount: 5 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "October 2026 costs are not added yet (5 items missing).",
    );
    expect(screen.getByRole("link", { name: "Add now" })).toHaveAttribute(
      "href",
      "/STK/costs?month=2026-10",
    );
  });
});
