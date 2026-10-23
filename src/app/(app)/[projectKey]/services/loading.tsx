import { ServiceGridSkeleton } from "@/features/service-registry/service-skeletons";

/** Service registry shell while the list loads. */
export default function Loading() {
  return <ServiceGridSkeleton />;
}
