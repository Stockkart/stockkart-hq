import { describe, expect, it } from "vitest";

import { type ConvertSubject, convertProblem } from "./convert";

const subject = (overrides: Partial<ConvertSubject> = {}): ConvertSubject => ({
  type: "task",
  parentType: null,
  childTypes: [],
  ...overrides,
});

describe("convertProblem (ISS-14 under the ISS-3 parent rules)", () => {
  it("allows a free task to become a bug, story or epic", () => {
    expect(convertProblem(subject(), "bug")).toBeNull();
    expect(convertProblem(subject(), "story")).toBeNull();
    expect(convertProblem(subject(), "epic")).toBeNull();
  });

  it("blocks converting an epic that has children", () => {
    expect(convertProblem(subject({ type: "epic", childTypes: ["story", "task"] }), "task")).toBe(
      "This epic has 2 child issues; move them to another epic first",
    );
    expect(convertProblem(subject({ type: "epic" }), "story")).toBeNull();
  });

  it("blocks a subtask without a parent, or under an epic", () => {
    expect(convertProblem(subject(), "subtask")).toBe(
      "A subtask needs a parent issue; set one first",
    );
    expect(convertProblem(subject({ parentType: "epic" }), "subtask")).toMatch(
      /parent cannot be an epic/,
    );
    expect(convertProblem(subject({ type: "bug", parentType: "story" }), "subtask")).toBeNull();
  });

  it("blocks a subtask that would have children", () => {
    expect(
      convertProblem(subject({ parentType: "story", childTypes: ["subtask"] }), "subtask"),
    ).toBe("A subtask cannot have children; move its child issue first");
  });

  it("keeps a subtask's non-epic parent from becoming a task's parent", () => {
    expect(convertProblem(subject({ type: "subtask", parentType: "story" }), "task")).toBe(
      "A task's parent must be an epic; change or remove the parent first",
    );
  });

  it("blocks an epic with a parent, or with subtasks under it", () => {
    expect(convertProblem(subject({ parentType: "epic" }), "epic")).toMatch(/cannot have a parent/);
    expect(convertProblem(subject({ childTypes: ["subtask"] }), "epic")).toMatch(
      /subtasks need a non-epic parent/,
    );
  });

  it("says when nothing would change", () => {
    expect(convertProblem(subject({ type: "epic" }), "epic")).toBe("It is already an epic");
  });
});
