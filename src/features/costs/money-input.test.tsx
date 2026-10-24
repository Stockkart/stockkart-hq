// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MoneyInput } from "./money-input";

describe("MoneyInput (COST-3)", () => {
  it("commits minor units on Enter and on blur", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<MoneyInput label="Amount" currency="INR" value={null} onCommit={onCommit} />);
    const input = screen.getByLabelText("Amount");
    await user.type(input, "1,234.5{Enter}");
    expect(onCommit).toHaveBeenLastCalledWith(123450);
    expect(input).toHaveValue("1234.50");
  });

  it("keeps a typing error on the field and sends nothing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<MoneyInput label="Amount" currency="USD" value={500} onCommit={onCommit} />);
    const input = screen.getByLabelText("Amount");
    await user.clear(input);
    await user.type(input, "1.234");
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use at most 2 decimals")).toBeInTheDocument();
    // Esc puts the saved value back.
    await user.type(input, "{Escape}");
    expect(input).toHaveValue("5");
  });

  it("commits null when cleared", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<MoneyInput label="Amount" currency="USD" value={500} onCommit={onCommit} />);
    await user.clear(screen.getByLabelText("Amount"));
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(null);
  });
});
