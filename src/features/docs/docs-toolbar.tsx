"use client";

import { FileCheck2, FilePlus2, LayoutTemplate } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { whenIdle } from "@/lib/idle";

import {
  NewAdrDialog,
  NewDocDialog,
  preloadDocTemplates,
  TemplatePickerDialog,
} from "./doc-dialogs";

/** "New page", "New from template" (DOC-5) and "New ADR" (ADR-1) buttons. */
export function DocsToolbar({
  projectKey,
  projectKeys,
  show = ["page", "template", "adr"],
}: {
  projectKey: string;
  projectKeys: string[];
  show?: ("page" | "template" | "adr")[];
}) {
  const [open, setOpen] = useState<"page" | "template" | "adr" | null>(null);
  const close = (isOpen: boolean) => {
    if (!isOpen) setOpen(null);
  };
  const offersTemplates = show.includes("template");
  // The template picker opens with its list: fetch it while the browser is idle.
  useEffect(() => (offersTemplates ? whenIdle(preloadDocTemplates) : undefined), [offersTemplates]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {show.includes("page") ? (
        <Button size="sm" variant="outline" onClick={() => setOpen("page")}>
          <FilePlus2 aria-hidden="true" />
          New page
        </Button>
      ) : null}
      {show.includes("template") ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen("template")}
          onPointerEnter={preloadDocTemplates}
          onFocus={preloadDocTemplates}
        >
          <LayoutTemplate aria-hidden="true" />
          New from template
        </Button>
      ) : null}
      {show.includes("adr") ? (
        <Button size="sm" onClick={() => setOpen("adr")}>
          <FileCheck2 aria-hidden="true" />
          New ADR
        </Button>
      ) : null}
      <NewDocDialog open={open === "page"} onOpenChange={close} projectKey={projectKey} />
      <TemplatePickerDialog
        open={open === "template"}
        onOpenChange={close}
        projectKey={projectKey}
        projectKeys={projectKeys}
      />
      <NewAdrDialog open={open === "adr"} onOpenChange={close} projectKey={projectKey} />
    </div>
  );
}
