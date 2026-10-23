import { ListPageSkeleton } from "@/features/shell/page-skeletons";

/** Incident list shell while it loads. */
export default function Loading() {
  return <ListPageSkeleton label="incidents" />;
}
