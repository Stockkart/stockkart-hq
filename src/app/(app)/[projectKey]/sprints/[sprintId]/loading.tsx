import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Sprint shell while its burndown and issues load. */
export default function Loading() {
  return <SimplePageSkeleton label="sprint" />;
}
