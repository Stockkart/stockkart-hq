import { SimplePageSkeleton } from "@/features/shell/page-skeletons";

/** Todos shell while they load. */
export default function Loading() {
  return <SimplePageSkeleton label="todos" narrow />;
}
