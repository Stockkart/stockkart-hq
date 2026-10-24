import { type StatusCategory, type StatusDefaultFor } from "@/lib/issues/constants";
import { type UserOption } from "@/lib/issues/views";
import { type ProjectViewDefaults } from "@/lib/views/view-defaults";

/** Read models of the project settings page (PRJ-2, PRJ-3). Plain data only. */

export interface ProjectGeneral {
  id: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  defaultAssigneeId: string | null;
  sprintLengthDays: number;
  /** SPR-5: make a retro doc when a sprint is completed. */
  autoRetro: boolean;
}

export interface StatusSetting {
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
  isDefaultFor: StatusDefaultFor | null;
  /** BRD-5: the board column's WIP limit, or null for none. */
  wipLimit: number | null;
  /** Live issues in this status. */
  issueCount: number;
  /** Issues in the trash that keep this status (a delete moves them too). */
  trashedCount: number;
}

export interface LabelSetting {
  id: string;
  name: string;
  color: string | null;
  /** Live issues with this label. */
  issueCount: number;
}

export interface ComponentSetting {
  id: string;
  name: string;
  githubRepo: string | null;
  /** Live issues in this component. */
  issueCount: number;
}

export interface ProjectSettings {
  project: ProjectGeneral;
  /** BRD-6 / VW-4 (Views tab). */
  viewDefaults: ProjectViewDefaults;
  statuses: StatusSetting[];
  labels: LabelSetting[];
  components: ComponentSetting[];
  users: UserOption[];
}
