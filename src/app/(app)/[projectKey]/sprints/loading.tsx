import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Sprints shell while the sprints and charts load. */
export default function Loading() {
  return <SimplePageSkeleton label="sprints" />;
}
