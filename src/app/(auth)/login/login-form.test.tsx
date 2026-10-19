// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const signInAction = vi.hoisted(() =>
  vi.fn(async (_previous: unknown, formData: FormData) => ({
    error: "Invalid email or password",
    email: String(formData.get("email") ?? ""),
  })),
);
vi.mock("@/server/actions/auth", () => ({ signInAction }));

const { LoginForm } = await import("./login-form");

describe("LoginForm", () => {
  it("has labelled fields and an always-present live region", () => {
    render(<LoginForm callbackPath="/my-work" initialError={null} />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toBeEmptyDOMElement();
  });

  it("is keyboard usable and announces the generic error", async () => {
    const user = userEvent.setup();
    render(<LoginForm callbackPath="/my-work" initialError={null} />);

    await user.keyboard("staff@example.test");
    await user.tab();
    await user.keyboard("wrong{Enter}");

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(signInAction).toHaveBeenCalledTimes(1);
    const formData = signInAction.mock.calls[0]?.[1];
    expect(formData?.get("callbackUrl")).toBe("/my-work");
    expect(screen.getByLabelText("Email")).toHaveValue("staff@example.test");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows an error passed from the page", () => {
    render(<LoginForm callbackPath="/my-work" initialError="Access denied" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
  });
});
