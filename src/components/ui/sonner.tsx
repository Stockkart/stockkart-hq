"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useResolvedTheme } from "@/features/theme/use-resolved-theme";

/**
 * App-wide toasts. Sonner announces them through an `aria-live` region. Its `theme` follows
 * the app (README "Dark mode"), so its own icons and close button match the token colours.
 */
function Toaster(props: ToasterProps) {
  const theme = useResolvedTheme();
  return (
    <Sonner
      position="bottom-right"
      closeButton
      theme={theme}
      toastOptions={{
        classNames: {
          toast: "!bg-popover !text-popover-foreground !border-border",
          description: "!text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
