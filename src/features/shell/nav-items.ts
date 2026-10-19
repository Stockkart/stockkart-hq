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

/** SPEC §5.1 app shell. Phase 0 has only My Work; the rest are placeholders for Phase 1+. */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "My Work", icon: UserRound, href: "/my-work" },
      { label: "Todos", icon: ListTodo },
    ],
  },
  {
    heading: "STK",
    items: [
      { label: "Backlog", icon: LayoutList },
      { label: "Board", icon: SquareKanban },
      { label: "Issues", icon: ListChecks },
      { label: "Sprints", icon: Timer },
      { label: "Roadmap", icon: Flag },
      { label: "Docs", icon: BookOpen },
      { label: "ADRs", icon: FileCheck2 },
      { label: "Diagrams", icon: Network },
      { label: "Incidents", icon: Siren },
      { label: "Services", icon: Server },
    ],
  },
  {
    items: [{ label: "Settings", icon: Settings }],
  },
];
