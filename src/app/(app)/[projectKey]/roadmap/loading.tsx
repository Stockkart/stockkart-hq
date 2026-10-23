import { ListPageSkeleton } from "@/features/shell/page-skeletons";

/** Roadmap shell while the epics and their dependencies load. */
export default function Loading() {
  return <ListPageSkeleton label="roadmap" />;
}
