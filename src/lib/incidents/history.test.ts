import { describe, expect, it } from "vitest";

import { incidentActivityText } from "./history";

const names = {
  users: new Map([["u1", "Ada"]]),
  services: new Map([
    ["s1", "API"],
    ["s2", "DB"],
  ]),
};
const entry = (
  action: string,
  field: string | null,
  fromValue: string | null,
  toValue: string | null,
) => ({
  id: "a",
  actorName: "Ada",
  action,
  field,
  fromValue,
  toValue,
  createdAt: new Date(),
});

describe("incidentActivityText", () => {
  it("names severities, statuses, users and services", () => {
    expect(incidentActivityText(entry("updated", "severity", "sev2", "sev1"), names)).toBe(
      "changed the severity from SEV2 to SEV1",
    );
    expect(
      incidentActivityText(entry("updated", "status", "resolved", "investigating"), names),
    ).toBe("changed the status from Resolved to Investigating");
    expect(incidentActivityText(entry("updated", "commanderId", null, "u1"), names)).toBe(
      "changed the commander from none to Ada",
    );
    expect(incidentActivityText(entry("updated", "services", "s1", "s1,s2,s9"), names)).toBe(
      "changed the affected services from API to API, DB, a deleted service",
    );
  });

  it("describes the other events", () => {
    expect(incidentActivityText(entry("created", null, null, "sev1"), names)).toBe(
      "declared the incident",
    );
    expect(incidentActivityText(entry("updated", "postmortemDocId", null, "d"), names)).toBe(
      "created the postmortem",
    );
    expect(incidentActivityText(entry("linked", "followUp", null, "i"), names)).toBe(
      "linked a follow-up issue",
    );
  });
});
