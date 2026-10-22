import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Notifications shell while it loads. */
export default function Loading() {
  return <SimplePageSkeleton label="Notifications" narrow />;
}
