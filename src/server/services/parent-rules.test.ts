import { describe, expect, it } from "vitest";

import { type IssueType } from "@/lib/issues/constants";

import { type ParentCandidate, parentProblem } from "./parent-rules";

const P = "project-1";
const parent = (type: IssueType, extra: Partial<ParentCandidate> = {}): ParentCandidate => ({
  id: `parent-${type}`,
  projectId: P,
  type,
  deletedAt: null,
  ...extra,
});
const child = (type: IssueType, id?: string) => ({ id, projectId: P, type });

describe("ISS-3 parent rules", () => {
  it.each(["story", "task", "bug", "spike", "tech_debt"] as const)(
    "%s: parent is optional and must be an epic",
    (type) => {
      expect(parentProblem(child(type), null)).toBeNull();
      expect(parentProblem(child(type), parent("epic"))).toBeNull();
      expect(parentProblem(child(type), parent("story"))).toMatch(/must be an epic/);
      expect(parentProblem(child(type), parent("subtask"))).toMatch(/must be an epic/);
    },
  );

  it("subtask: parent is required and is any non-epic, non-subtask issue", () => {
    expect(parentProblem(child("subtask"), null)).toMatch(/needs a parent/);
    for (const type of ["story", "task", "bug", "spike", "tech_debt"] as const) {
      expect(parentProblem(child("subtask"), parent(type))).toBeNull();
    }
    expect(parentProblem(child("subtask"), parent("epic"))).toMatch(/cannot be an epic/);
    expect(parentProblem(child("subtask"), parent("subtask"))).toMatch(/another subtask/);
  });

  it("epic: no parent at all", () => {
    expect(parentProblem(child("epic"), null)).toBeNull();
    expect(parentProblem(child("epic"), parent("epic"))).toMatch(/epic cannot have a parent/);
  });

  it("rejects self, deleted and cross-project parents", () => {
    expect(parentProblem(child("task", "parent-epic"), parent("epic"))).toMatch(/own parent/);
    expect(parentProblem(child("task"), parent("epic", { deletedAt: new Date() }))).toMatch(
      /deleted/,
    );
    expect(parentProblem(child("task"), parent("epic", { projectId: "other" }))).toMatch(
      /same project/,
    );
  });
});
