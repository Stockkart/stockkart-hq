import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** One release's shell while its issues load. */
export default function Loading() {
  return <SimplePageSkeleton label="release" />;
}
