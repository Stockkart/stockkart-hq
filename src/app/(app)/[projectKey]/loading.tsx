import { ProjectPageSkeleton } from "@/features/shell/page-skeletons";

/** Project pages without their own shell; also covers the docs layout while its tree loads. */
export default function Loading() {
  return <ProjectPageSkeleton />;
}
