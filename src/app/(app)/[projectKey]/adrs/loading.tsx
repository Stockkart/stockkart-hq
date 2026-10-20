import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** ADR log shell while it loads. */
export default function Loading() {
  return <SimplePageSkeleton label="decisions" />;
}
