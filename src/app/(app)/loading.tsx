import { ProjectPageSkeleton } from "@/features/shell/page-skeletons";

/** Fallback for every signed-in page while it loads (the shell stays). */
export default function Loading() {
  return <ProjectPageSkeleton />;
}
