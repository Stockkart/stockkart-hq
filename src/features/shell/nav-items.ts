import {
  BookOpen,
  FileCheck2,
  Flag,
  LayoutList,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Network,
  Server,
  Settings,
  Siren,
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
 * SPEC §5.1 app shell. Issues, Backlog, Board, My Work and Todos work in Phase 1; the other
 * project pages show a "coming soon" placeholder until their slice lands. Settings has no
 * page yet.
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
      { label: "Docs", icon: BookOpen, href: projectHref("docs") },
      { label: "ADRs", icon: FileCheck2, href: projectHref("adrs") },
      { label: "Diagrams", icon: Network, href: projectHref("diagrams") },
      { label: "Incidents", icon: Siren, href: projectHref("incidents") },
      { label: "Services", icon: Server, href: projectHref("services") },
    ],
  },
  {
    items: [{ label: "Settings", icon: Settings }],
  },
];
