import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Profile shell while it loads. */
export default function Loading() {
  return <SimplePageSkeleton label="profile" narrow />;
}
