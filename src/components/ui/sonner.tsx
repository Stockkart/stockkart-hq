"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** App-wide toasts. Sonner announces them through an `aria-live` region. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      closeButton
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
