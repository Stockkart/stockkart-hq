import { ListPageSkeleton } from "@/features/shell/page-skeletons";

/** Backlog shell while the issues load. */
export default function Loading() {
  return <ListPageSkeleton label="backlog" />;
}
