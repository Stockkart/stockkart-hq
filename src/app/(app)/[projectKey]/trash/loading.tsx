import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Trash shell while it loads. */
export default function Loading() {
  return <SimplePageSkeleton label="trash" narrow />;
}
