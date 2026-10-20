import { ListPageSkeleton } from "@/features/shell/page-skeletons";

/** Issue list shell while the issues load. */
export default function Loading() {
  return <ListPageSkeleton label="issues" />;
}
