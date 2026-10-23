/**
 * SVC-1 "Add Stockkart defaults": the services Stockkart runs today, by name, repo and
 * runtime only. Deliberately NO URLs (and of course no credentials): people add the links
 * they use. Created idempotently by slug, so pressing the button twice adds nothing.
 */
export interface DefaultService {
  slug: string;
  name: string;
  runtime: string | null;
  repo: string | null;
  description: string;
}

export const STOCKKART_DEFAULT_SERVICES: readonly DefaultService[] = [
  {
    slug: "inventory-api",
    name: "inventory-api",
    runtime: "DigitalOcean App Platform",
    repo: "Stockkart/inventory-api",
    description: "The Stockkart backend API.",
  },
  {
    slug: "inventory-platform",
    name: "inventory-platform",
    runtime: null,
    repo: "Stockkart/inventory-platform",
    description: "The Stockkart web and mobile clients.",
  },
  {
    slug: "stockkart-hq",
    name: "stockkart-hq",
    runtime: "Vercel",
    repo: "Stockkart/stockkart-hq",
    description: "This app: issues, docs, incidents and the service registry.",
  },
  {
    slug: "mongodb-atlas",
    name: "MongoDB Atlas",
    runtime: "MongoDB Atlas",
    repo: null,
    description: "The inventory-api database.",
  },
  {
    slug: "neon-postgres",
    name: "Neon Postgres",
    runtime: "Neon",
    repo: null,
    description: "The stockkart-hq database.",
  },
];
