import {
  BookOpen,
  FileCheck2,
  Flag,
  LayoutList,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Network,
  Package,
  Server,
  Settings,
  Siren,
  SlidersHorizontal,
  SquareKanban,
  Timer,
  UserRound,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Present only for pages that exist. Items without href render as "coming soon". */
  href?: string;
}

export interface NavSection {
  /** Visible heading, e.g. the project key. */
  heading?: string;
  items: NavItem[];
}

/** The only project today (SPEC §3); the shell links to it and quick create defaults to it. */
export const DEFAULT_PROJECT_KEY = "STK";

const projectHref = (section: string) => `/${DEFAULT_PROJECT_KEY}/${section}`;

/**
 * SPEC §5.1 app shell. Every item works: My Work, Todos, Backlog, Board, Issues, Sprints,
 * Roadmap, Releases, Docs, ADRs, Diagrams, Incidents and Services; an unknown section is a
 * 404 (`[projectKey]/[section]`). Settings opens the profile (GitHub username, GH-4).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "My Work", icon: UserRound, href: "/my-work" },
      { label: "Todos", icon: ListTodo, href: "/todos" },
    ],
  },
  {
    heading: DEFAULT_PROJECT_KEY,
    items: [
      { label: "Backlog", icon: LayoutList, href: projectHref("backlog") },
      { label: "Board", icon: SquareKanban, href: projectHref("board") },
      { label: "Issues", icon: ListChecks, href: projectHref("issues") },
      { label: "Sprints", icon: Timer, href: projectHref("sprints") },
      { label: "Roadmap", icon: Flag, href: projectHref("roadmap") },
      // REL-1/2.
      { label: "Releases", icon: Package, href: projectHref("releases") },
      { label: "Docs", icon: BookOpen, href: projectHref("docs") },
      { label: "ADRs", icon: FileCheck2, href: projectHref("adrs") },
      { label: "Diagrams", icon: Network, href: projectHref("diagrams") },
      { label: "Incidents", icon: Siren, href: projectHref("incidents") },
      { label: "Services", icon: Server, href: projectHref("services") },
      // PRJ-3 (statuses, labels, components; the trash is linked from there, ISS-13).
      { label: "Project settings", icon: SlidersHorizontal, href: projectHref("settings") },
    ],
  },
  {
    items: [{ label: "Settings", icon: Settings, href: "/settings/profile" }],
  },
];
