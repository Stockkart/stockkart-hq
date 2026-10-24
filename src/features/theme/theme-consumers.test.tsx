// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetThemeDom, stubColorScheme } from "@/test/theme-dom";

/**
 * The JS consumers of the theme get the resolved theme from `useResolvedTheme` and follow
 * a switch live (README "Dark mode"). Excalidraw and sonner are stand-ins that record their
 * props; React Flow is real (it puts its colour mode on the wrapper as a class).
 */

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
const exportToSvg = vi.hoisted(() =>
  vi.fn(async (_input: { appState: Record<string, unknown> }) =>
    document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  ),
);
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER" },
  getNonDeletedElements: (elements: unknown) => elements,
  exportToSvg,
  hashElementsVersion: () => 0,
  restoreElements: (elements: unknown) => elements,
  Excalidraw: ({ theme }: { theme?: string }) => (
    <div data-testid="excalidraw" data-theme={theme} />
  ),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
  Toaster: ({ theme }: { theme?: string }) => <div data-testid="sonner" data-theme={theme} />,
}));
vi.mock("@/server/actions/diagrams", () => ({ searchLinkableDocsAction: vi.fn() }));

const { default: WhiteboardCanvas } = await import("@/features/diagrams/whiteboard-canvas");
const { default: FlowCanvas } = await import("@/features/diagrams/flow-canvas");
const { Toaster } = await import("@/components/ui/sonner");
const { diagramSvg } = await import("@/features/diagrams/render");

beforeEach(() => {
  resetThemeDom();
  // React Flow measures nodes; jsdom has no layout.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    },
  );
});

async function setHtmlClass(className: string) {
  await act(async () => {
    document.documentElement.className = className;
    await Promise.resolve();
  });
}

describe("theme consumers", () => {
  it("Excalidraw gets theme dark/light from the html class", async () => {
    stubColorScheme(false);
    resetThemeDom("dark");
    render(
      <WhiteboardCanvas scene={{ elements: [], appState: {} }} onNavigate={vi.fn()} readOnly />,
    );
    expect(screen.getByTestId("excalidraw")).toHaveAttribute("data-theme", "dark");
    await setHtmlClass("");
    await waitFor(() =>
      expect(screen.getByTestId("excalidraw")).toHaveAttribute("data-theme", "light"),
    );
  });

  it("React Flow gets colorMode from the system preference in system mode", async () => {
    const scheme = stubColorScheme(true);
    resetThemeDom("theme-system");
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <FlowCanvas
          scene={{ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }}
          projectKey="STK"
          onOpenLink={vi.fn()}
          readOnly
        />
      </div>,
    );
    const flow = container.querySelector(".react-flow");
    expect(flow).toHaveClass("dark");
    act(() => scheme.setDark(false));
    await waitFor(() => expect(flow).toHaveClass("light"));
  });

  it("sonner gets the resolved theme", async () => {
    stubColorScheme(false);
    render(<Toaster />);
    expect(screen.getByTestId("sonner")).toHaveAttribute("data-theme", "light");
    await setHtmlClass("dark");
    await waitFor(() => expect(screen.getByTestId("sonner")).toHaveAttribute("data-theme", "dark"));
  });

  it("diagram exports and thumbnails stay light in dark mode", async () => {
    stubColorScheme(true);
    resetThemeDom("dark");
    await diagramSvg("whiteboard", { elements: [], appState: {} });
    expect(exportToSvg.mock.lastCall?.[0].appState).toMatchObject({
      exportWithDarkMode: false,
      viewBackgroundColor: "#ffffff",
    });
    const flow = await diagramSvg("flow", {
      nodes: [{ id: "a", type: "service", position: { x: 0, y: 0 }, data: { label: "api" } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(flow).toContain('fill="#ffffff"');
  });
});
