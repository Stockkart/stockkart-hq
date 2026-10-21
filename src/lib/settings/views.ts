import { type StatusCategory, type StatusDefaultFor } from "@/lib/issues/constants";
import { type UserOption } from "@/lib/issues/views";

/** Read models of the project settings page (PRJ-2, PRJ-3). Plain data only. */

export interface ProjectGeneral {
  id: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  defaultAssigneeId: string | null;
  sprintLengthDays: number;
}

export interface StatusSetting {
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
  isDefaultFor: StatusDefaultFor | null;
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
  statuses: StatusSetting[];
  labels: LabelSetting[];
  components: ComponentSetting[];
  users: UserOption[];
}
