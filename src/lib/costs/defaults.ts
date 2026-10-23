import { type BillingCycle, type CostCategory, type CostCurrency } from "./constants";

/**
 * COST-6 "Add Stockkart defaults": what running Stockkart costs today, by name, vendor,
 * category, cycle and currency only. Deliberately NO amounts (people enter what each
 * actually costs). Created idempotently by name (case-insensitive, live items), and linked
 * to the service-registry entry with `serviceSlug` when that service exists (SVC-1
 * defaults use these slugs).
 */
export interface DefaultCostItem {
  name: string;
  vendor: string | null;
  category: CostCategory;
  billingCycle: BillingCycle;
  currency: CostCurrency;
  serviceSlug: string | null;
}

export const STOCKKART_DEFAULT_COSTS: readonly DefaultCostItem[] = [
  {
    name: "DigitalOcean App Platform",
    vendor: "DigitalOcean",
    category: "hosting",
    billingCycle: "monthly",
    currency: "USD",
    serviceSlug: "inventory-api",
  },
  {
    name: "MongoDB Atlas",
    vendor: "MongoDB",
    category: "database",
    billingCycle: "monthly",
    currency: "USD",
    serviceSlug: "mongodb-atlas",
  },
  {
    name: "Vercel",
    vendor: "Vercel",
    category: "hosting",
    billingCycle: "monthly",
    currency: "USD",
    serviceSlug: "stockkart-hq",
  },
  {
    name: "Neon Postgres",
    vendor: "Neon",
    category: "database",
    billingCycle: "usage",
    currency: "USD",
    serviceSlug: "neon-postgres",
  },
  {
    name: "Cloudflare R2",
    vendor: "Cloudflare",
    category: "storage",
    billingCycle: "usage",
    currency: "USD",
    serviceSlug: null,
  },
  {
    name: "Domain",
    vendor: null,
    category: "domain_dns",
    billingCycle: "yearly",
    currency: "INR",
    serviceSlug: null,
  },
  {
    name: "Resend",
    vendor: "Resend",
    category: "email",
    billingCycle: "monthly",
    currency: "USD",
    serviceSlug: null,
  },
  {
    name: "OpenAI",
    vendor: "OpenAI",
    category: "ai_ocr",
    billingCycle: "usage",
    currency: "USD",
    serviceSlug: null,
  },
  {
    name: "Google Gemini",
    vendor: "Google",
    category: "ai_ocr",
    billingCycle: "usage",
    currency: "USD",
    serviceSlug: null,
  },
  {
    name: "AWS Textract",
    vendor: "AWS",
    category: "ai_ocr",
    billingCycle: "usage",
    currency: "USD",
    serviceSlug: null,
  },
  {
    name: "GitHub",
    vendor: "GitHub",
    category: "source_control",
    billingCycle: "monthly",
    currency: "USD",
    serviceSlug: null,
  },
  {
    name: "Grafana Cloud",
    vendor: "Grafana Labs",
    category: "monitoring",
    billingCycle: "monthly",
    currency: "USD",
    serviceSlug: null,
  },
  {
    name: "Razorpay fees",
    vendor: "Razorpay",
    category: "payments",
    billingCycle: "usage",
    currency: "INR",
    serviceSlug: null,
  },
];
