"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { callAction } from "@/features/issue/client-utils";
import { deleteServiceAction } from "@/server/actions/service-registry";

/** Soft delete (§9.3) after a confirmation; the slug stays reserved. */
export function DeleteServiceDialog({
  service,
  onOpenChange,
  onDeleted,
}: {
  service: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {service.name}?</DialogTitle>
          <DialogDescription>
            It disappears from the registry and from incident pickers. Past incidents keep it in
            their history.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await callAction(() =>
                  deleteServiceAction({ serviceId: service.id }),
                );
                if (result === null) return;
                onDeleted();
                onOpenChange(false);
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
