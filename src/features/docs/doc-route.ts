import { cache } from "react";

import { docQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

/**
 * Server components only (imports the database).
 *
 * The project's doc tree, once per request: the docs layout and its pages both need it
 * (React `cache`). It references the project by key, so it runs in the page's round trip.
 */
export const docTree = cache((projectKey: string) =>
  docQueries.listTree(projectIdByKey(projectKey)),
);
