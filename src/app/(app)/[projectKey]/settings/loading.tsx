import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Project settings shell while it loads. */
export default function Loading() {
  return <SimplePageSkeleton label="project settings" narrow />;
}
