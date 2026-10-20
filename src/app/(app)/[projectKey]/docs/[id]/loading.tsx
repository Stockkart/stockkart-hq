import { DocSkeleton } from "@/features/shell/page-skeletons";

/** Doc editor shell inside the docs layout (the tree stays) while the doc loads. */
export default function Loading() {
  return <DocSkeleton />;
}
