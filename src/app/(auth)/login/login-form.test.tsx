// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SIGN_IN_MESSAGES } from "@/lib/sign-in-messages";

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
    // role="alert" is already an assertive live region; no redundant aria-live.
    expect(alert).not.toHaveAttribute("aria-live");
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

  it("marks the fields invalid only for a credentials error", () => {
    const { unmount } = render(
      <LoginForm callbackPath="/my-work" initialError={SIGN_IN_MESSAGES.invalid_credentials} />,
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    unmount();

    for (const message of [SIGN_IN_MESSAGES.unavailable, SIGN_IN_MESSAGES.access_denied]) {
      const view = render(<LoginForm callbackPath="/my-work" initialError={message} />);
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
      expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
      // Still linked to the message so it is read out with the field.
      expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", "login-error");
      view.unmount();
    }
  });
});
