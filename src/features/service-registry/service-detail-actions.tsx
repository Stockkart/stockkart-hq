"use client";

import { Pencil, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { servicesPath } from "@/lib/service-registry/slug";
import { type ServiceDetail, type UserOption } from "@/lib/service-registry/views";

import { DeleteServiceDialog } from "./delete-service-dialog";
import { ServiceFormDialog } from "./service-form-dialog";

/** Edit (also opened by `?edit=1` from the list's menu) and Delete on the service page. */
export function ServiceDetailActions({
  projectKey,
  service,
  users,
  initialEdit = false,
}: {
  projectKey: string;
  service: ServiceDetail;
  users: UserOption[];
  /** `?edit=1` (the list's "Edit" menu item opens the form here). */
  initialEdit?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState(initialEdit);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Pencil aria-hidden="true" />
        Edit
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDeleting(true)}>
        <Trash2 aria-hidden="true" />
        Delete
      </Button>
      {editing ? (
        <ServiceFormDialog
          // A fresh form after every save (the page re-renders with the new values).
          key={service.updatedAt.toString()}
          open
          onOpenChange={(open) => {
            if (open) return;
            setEditing(false);
            if (initialEdit) router.replace(pathname);
          }}
          projectKey={projectKey}
          users={users}
          service={service}
        />
      ) : null}
      {deleting ? (
        <DeleteServiceDialog
          service={service}
          onOpenChange={setDeleting}
          onDeleted={() => router.push(servicesPath(projectKey))}
        />
      ) : null}
    </div>
  );
}
