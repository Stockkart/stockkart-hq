import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Releases shell while the list loads. */
export default function Loading() {
  return <SimplePageSkeleton label="releases" />;
}
