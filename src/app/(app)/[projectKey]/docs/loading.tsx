import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Docs index shell (tree and list) while it loads. */
export default function Loading() {
  return <SimplePageSkeleton label="docs" />;
}
