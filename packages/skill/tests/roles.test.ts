import { describe, expect, test } from "vite-plus/test";
import {
  capabilityCategories,
  capabilityRecommendationIssues,
  getRoleSpecification,
  initialCapabilityGrant,
  recommendedCapabilitiesByRolePhase,
  neverGrantableCapabilities,
  roleSpecificationIds,
  roleSpecifications,
  validateCapabilityGrant,
} from "../skills/sync-engine/scripts/roles.ts";
import { thrownValue } from "./test-support.ts";

const noCapabilities = {
  readableAreas: [],
  writableAreas: [],
  toolKinds: [],
  projectShell: "none",
  network: false,
  generatedOutput: false,
  longRunningProcesses: false,
} as const;

describe("typed role specifications", () => {
  test("enumerates every operational role and phase in one table", () => {
    expect(roleSpecificationIds).toEqual([
      "designer/decomposition",
      "designer/contracts",
      "critic/decomposition",
      "critic/contracts",
      "critic/implementation",
      "critic/verification",
      "concept-worker/implementation",
      "application-worker/implementation",
      "frontend-worker/implementation",
      "evidence-worker/evidence",
    ]);

    expect(
      roleSpecificationIds.map((id) => {
        const specification = roleSpecifications[id];
        return [specification.role, specification.phase, specification.templatePath];
      }),
    ).toEqual([
      ["designer", "decomposition", "roles/designer-decomposition.md"],
      ["designer", "contracts", "roles/designer-contracts.md"],
      ["critic", "decomposition", "roles/critic-decomposition.md"],
      ["critic", "contracts", "roles/critic-contracts.md"],
      ["critic", "implementation", "roles/critic-implementation.md"],
      ["critic", "verification", "roles/critic-verification.md"],
      ["concept-worker", "implementation", "roles/concept-worker.md"],
      ["application-worker", "implementation", "roles/application-worker.md"],
      ["frontend-worker", "implementation", "roles/frontend-worker.md"],
      ["evidence-worker", "evidence", "roles/evidence-worker.md"],
    ]);
  });

  test("declares ordered guidance, input contracts, and return headings", () => {
    const designer = roleSpecifications["designer/contracts"];
    expect(designer.guidancePaths).toEqual([
      "guidance/design/contracts.md",
      "guidance/design/authored-format.md",
      "guidance/design/ssf.md",
      "guidance/design/boundary.md",
    ]);
    expect(
      designer.inputs.map(({ id, heading, cardinality, delivery }) => ({
        id,
        heading,
        cardinality,
        delivery,
      })),
    ).toContainEqual({
      id: "accepted-decomposition",
      heading: "Accepted decomposition",
      cardinality: "zero-or-one",
      delivery: "retained",
    });
    expect(
      roleSpecifications["critic/contracts"].inputs.find(
        ({ id }) => id === "accepted-decomposition",
      ),
    ).toMatchObject({ cardinality: "zero-or-one", delivery: "retained" });
    expect(designer.returnShape.map(({ heading }) => heading)).toEqual([
      "Status",
      "Changed",
      "Questions",
      "Checks",
    ]);

    const implementationReview = roleSpecifications["critic/implementation"];
    expect(implementationReview.guidancePaths).toEqual([
      "guidance/implementation/framework-safety.md",
      "guidance/design/ssf-reading.md",
      "guidance/design/boundary.md",
      "guidance/api/composition.md",
    ]);
    expect(
      implementationReview.inputs.map(({ id, cardinality, delivery }) => ({
        id,
        cardinality,
        delivery,
      })),
    ).toEqual([
      { id: "task", cardinality: "exactly-one", delivery: "inline" },
      { id: "brief", cardinality: "exactly-one", delivery: "retained" },
      { id: "contracts", cardinality: "one-or-more", delivery: "retained" },
      { id: "accepted-decomposition", cardinality: "zero-or-one", delivery: "retained" },
      { id: "changed-source-and-tests", cardinality: "one-or-more", delivery: "inline" },
      { id: "public-references", cardinality: "zero-or-more", delivery: "retained" },
      { id: "context", cardinality: "zero-or-more", delivery: "retained" },
    ]);
    expect(implementationReview.returnShape.map(({ heading }) => heading)).toEqual([
      "Verdict",
      "Assessments",
      "Findings",
    ]);

    const verification = roleSpecifications["critic/verification"];
    expect(verification.inputs.map(({ id }) => id)).toEqual([
      "task",
      "brief",
      "original-findings",
      "revised-candidate",
      "affected-design",
      "review-guidance",
      "context",
    ]);
    expect(verification.returnShape.map(({ heading }) => heading)).toEqual(["Verdict", "Findings"]);
    expect(verification.returnShape[1]?.guidance).toBe(
      "Stable findings or routed blockers resolved/unresolved; direct regressions or none.",
    );

    for (const id of roleSpecificationIds) {
      const specification = roleSpecifications[id];
      expect(new Set(specification.inputs.map(({ id: inputId }) => inputId)).size).toBe(
        specification.inputs.length,
      );
      expect(specification.inputs.find(({ id: inputId }) => inputId === "task")).toMatchObject({
        cardinality: "exactly-one",
        delivery: "inline",
      });
      expect(specification.recommendedCapabilities).toBe(recommendedCapabilitiesByRolePhase[id]);
      expect(specification.inputs.at(-1)?.id).toBe("context");
    }
  });

  test("keeps conditional API context in inputs and requires application types", () => {
    const application = roleSpecifications["application-worker/implementation"];
    expect(application.guidancePaths).toContain("guidance/api/composition.md");
    expect(application.guidancePaths).not.toContain("guidance/api/application-example.md");
    expect(application.guidancePaths).not.toContain("guidance/api/http-host.md");
    for (const id of ["types", "concept-specifications", "concept-public-surfaces"]) {
      expect(application.inputs.find((input) => input.id === id)).toMatchObject({
        cardinality: "one-or-more",
        delivery: "retained",
      });
    }

    const frontend = roleSpecifications["frontend-worker/implementation"];
    expect(frontend.guidancePaths).not.toContain("guidance/api/http-client.md");

    for (const specification of [
      roleSpecifications["concept-worker/implementation"],
      application,
      frontend,
      roleSpecifications["evidence-worker/evidence"],
    ]) {
      expect(specification.inputs.find((input) => input.id === "public-references")).toMatchObject({
        heading: "Additional public framework references",
        cardinality: "zero-or-more",
        delivery: "retained",
      });
    }
  });

  test("requests concise semantic return fields", () => {
    expect(roleSpecifications["designer/decomposition"].returnShape).toEqual([
      {
        heading: "Status",
        required: true,
        guidance: "Complete or blocked unless the task requests another format.",
      },
      { heading: "Changed", required: true, guidance: "Paths changed, or none." },
      { heading: "Questions", required: true, guidance: "Material questions, or none." },
      {
        heading: "Checks",
        required: false,
        guidance: "Command and outcome when applicable.",
      },
    ]);
    expect(roleSpecifications["critic/decomposition"].returnShape).toEqual([
      { heading: "Verdict", required: true, guidance: "Approve, revise, or blocked." },
      {
        heading: "Assessments",
        required: true,
        guidance:
          "One overloaded, minimal, or fragmented verdict per concept; adverse assessments keyed to rows.",
      },
      {
        heading: "Findings",
        required: true,
        guidance: "Stable-ID blocker or material findings, or none.",
      },
    ]);
    expect(roleSpecifications["critic/contracts"].returnShape).toEqual([
      { heading: "Verdict", required: true, guidance: "Approve, revise, or blocked." },
      {
        heading: "Assessments",
        required: true,
        guidance: "Compact obligation-by-obligation semantic assessment; do not restate contracts.",
      },
      {
        heading: "Findings",
        required: true,
        guidance: "Stable-ID blocker or material findings, or none.",
      },
    ]);
    expect(roleSpecifications["critic/implementation"].returnShape).toEqual([
      { heading: "Verdict", required: true, guidance: "Approve, revise, or blocked." },
      {
        heading: "Assessments",
        required: true,
        guidance:
          "Compact contract-by-contract or obligation-by-obligation conformance assessment.",
      },
      {
        heading: "Findings",
        required: true,
        guidance: "Stable-ID blocker or material findings, or none.",
      },
    ]);
    expect(roleSpecifications["concept-worker/implementation"].returnShape).toEqual([
      { heading: "Status", required: true, guidance: "Complete or blocked." },
      { heading: "Changed", required: true, guidance: "Paths changed, or none." },
      { heading: "Checks", required: true, guidance: "Exact command and pass/fail outcome." },
      {
        heading: "Blockers",
        required: true,
        guidance: "Categorize as design, context, or environment.",
      },
      {
        heading: "Concerns",
        required: false,
        guidance: "Material non-blocking uncertainty only.",
      },
    ]);
    expect(roleSpecifications["evidence-worker/evidence"].returnShape.at(-1)).toEqual({
      heading: "Coverage",
      required: true,
      guidance: "Each relevant brief outcome linked to evidence and result.",
    });
  });

  test("encodes category capabilities without budgets or command allowlists", () => {
    expect(capabilityCategories).toEqual([
      "readableAreas",
      "writableAreas",
      "toolKinds",
      "projectShell",
      "network",
      "generatedOutput",
      "longRunningProcesses",
    ]);
    expect(neverGrantableCapabilities).toEqual([
      "git-mutation",
      "dependency-installation",
      "framework-internals",
      "workflow-management",
      "skill-cli-invocation",
      "delegation-or-handoff",
    ]);

    expect(recommendedCapabilitiesByRolePhase["designer/decomposition"]).toEqual({
      readableAreas: ["work-unit", "design"],
      writableAreas: ["current-decomposition"],
      toolKinds: ["repository-read", "repository-write"],
      projectShell: "none",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    });
    expect(recommendedCapabilitiesByRolePhase["critic/implementation"]).toEqual({
      readableAreas: ["application"],
      writableAreas: [],
      toolKinds: ["repository-read"],
      projectShell: "project-validation",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    });
    expect(recommendedCapabilitiesByRolePhase["concept-worker/implementation"]).toMatchObject({
      readableAreas: ["application"],
      writableAreas: ["owned-concept", "owned-test"],
      projectShell: "project-local",
      network: false,
      generatedOutput: true,
      longRunningProcesses: false,
    });
    expect(recommendedCapabilitiesByRolePhase["application-worker/implementation"]).toMatchObject({
      writableAreas: ["owned-integration", "owned-configuration", "owned-test"],
      network: false,
      generatedOutput: true,
      longRunningProcesses: true,
    });
    expect(recommendedCapabilitiesByRolePhase["frontend-worker/implementation"]).toMatchObject({
      writableAreas: ["owned-frontend", "owned-test"],
      network: true,
      generatedOutput: false,
      longRunningProcesses: true,
    });
    expect(recommendedCapabilitiesByRolePhase["evidence-worker/evidence"]).toMatchObject({
      writableAreas: ["owned-scenario", "owned-test"],
      projectShell: "project-validation",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    });

    for (const maximum of Object.values(recommendedCapabilitiesByRolePhase)) {
      expect(Object.keys(maximum)).toEqual(capabilityCategories);
    }
  });
});

describe("effective capability grants", () => {
  test("constructs role-aware starting grants", () => {
    expect(
      initialCapabilityGrant(getRoleSpecification("designer", "decomposition"), [], []),
    ).toEqual({
      readableAreas: [],
      writableAreas: [{ area: "current-decomposition", path: "decomposition.md" }],
      toolKinds: ["repository-read", "repository-write"],
      projectShell: "none",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    });
  });

  test("reserves decomposition and canonical authored design for their owning phases", () => {
    expect(() =>
      validateCapabilityGrant(getRoleSpecification("critic", "decomposition"), {
        ...noCapabilities,
        writableAreas: [{ area: "current-decomposition", path: "decomposition.md" }],
      }),
    ).toThrow("current-decomposition:decomposition.md is owned only by designer/decomposition");
    expect(() =>
      validateCapabilityGrant(getRoleSpecification("designer", "contracts"), {
        ...noCapabilities,
        writableAreas: [{ area: "assigned-design", path: "contracts.md" }],
      }),
    ).toThrow(
      "assigned-design:contracts.md must be types.md, concepts/<Name>.md, or compositions/<Name>.md",
    );
  });

  test("accepts bounded paths and returns canonical ordering", () => {
    const specification = getRoleSpecification("designer", "decomposition");
    const grant = validateCapabilityGrant(specification, {
      readableAreas: [
        { area: "design", path: "concepts/z.md" },
        { area: "work-unit", path: "." },
        { area: "design", path: "concepts/a.md" },
      ],
      writableAreas: [{ area: "current-decomposition", path: "decomposition.md" }],
      toolKinds: ["repository-write", "repository-read"],
      projectShell: "none",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    });

    expect(grant.readableAreas).toEqual([
      { area: "work-unit", path: "." },
      { area: "design", path: "concepts/a.md" },
      { area: "design", path: "concepts/z.md" },
    ]);
    expect(grant.toolKinds).toEqual(["repository-read", "repository-write"]);
  });

  test("treats non-design role capabilities as recommendations rather than gates", () => {
    const grant = validateCapabilityGrant(getRoleSpecification("critic", "decomposition"), {
      ...noCapabilities,
      writableAreas: [{ area: "owned-test", path: "tests/review.test.ts" }],
      toolKinds: ["repository-write"],
      projectShell: "project-local",
      network: true,
    });
    expect(grant).toMatchObject({
      writableAreas: [{ area: "owned-test", path: "tests/review.test.ts" }],
      projectShell: "project-local",
      network: true,
    });
    expect(
      capabilityRecommendationIssues(getRoleSpecification("critic", "decomposition"), grant),
    ).toEqual([
      "write area owned-test",
      "tool kind repository-write",
      "projectShell project-local",
      "network",
    ]);
  });

  test("flags an application ownership path that covers concept work", () => {
    const specification = getRoleSpecification("application-worker", "implementation");
    const grant = validateCapabilityGrant(specification, {
      ...noCapabilities,
      writableAreas: [{ area: "owned-integration", path: "src" }],
      toolKinds: ["repository-write"],
    });
    expect(capabilityRecommendationIssues(specification, grant)).toEqual([
      "write path owned-integration:src overlaps concept ownership",
    ]);
  });

  test.each([
    [
      "an escaping path",
      "concept-worker/implementation",
      {
        ...noCapabilities,
        readableAreas: [{ area: "application", path: "../framework" }],
      },
      "readableAreas[0] path must be a canonical relative POSIX path: ../framework",
    ],
    [
      "application workflow artifacts",
      "concept-worker/implementation",
      {
        ...noCapabilities,
        readableAreas: [{ area: "application", path: ".sync-engine/work" }],
      },
      "readableAreas[0] cannot grant .sync-engine/work",
    ],
    [
      "application skill directories",
      "concept-worker/implementation",
      {
        ...noCapabilities,
        readableAreas: [{ area: "application", path: ".cursor/skills" }],
      },
      "readableAreas[0] cannot grant .cursor/skills",
    ],
    [
      "a repeated work-unit root",
      "designer/decomposition",
      {
        ...noCapabilities,
        readableAreas: [{ area: "work-unit", path: ".sync-engine/work/example" }],
      },
      "readableAreas[0] path is already relative to work-unit and cannot repeat its root: .sync-engine/work/example",
    ],
    [
      "a repeated design root",
      "designer/contracts",
      {
        ...noCapabilities,
        readableAreas: [{ area: "design", path: "design/concepts" }],
      },
      "readableAreas[0] path is already relative to design and cannot repeat its root: design/concepts",
    ],
    [
      "an unmodeled capability",
      "designer/decomposition",
      { ...noCapabilities, gitMutation: true },
      "grant has unknown fields: gitMutation",
    ],
  ])("rejects %s", (_label, id, grant, detail) => {
    const [role, phase] = id.split("/");
    expect(
      thrownValue(() => validateCapabilityGrant(getRoleSpecification(role!, phase!), grant)),
    ).toEqual({
      name: "Error",
      message: `Invalid capability grant for ${id}: ${detail}`,
    });
  });

  test("requires a concrete family for every writable ownership area", () => {
    const covered = new Set<string>();
    for (const id of roleSpecificationIds) {
      const specification = roleSpecifications[id];
      for (const area of specification.recommendedCapabilities.writableAreas) {
        covered.add(area);
        expect(
          thrownValue(() =>
            validateCapabilityGrant(specification, {
              ...noCapabilities,
              writableAreas: [{ area, path: "." }],
            }),
          ),
        ).toEqual({
          name: "Error",
          message: `Invalid capability grant for ${id}: write area ${area} must name a concrete path family`,
        });
      }
    }
    expect(covered).toEqual(
      new Set([
        "current-decomposition",
        "assigned-design",
        "owned-concept",
        "owned-integration",
        "owned-configuration",
        "owned-frontend",
        "owned-test",
        "owned-scenario",
      ]),
    );
  });

  test("requires the decomposition write grant to name only its canonical file", () => {
    const specification = getRoleSpecification("designer", "decomposition");
    expect(
      thrownValue(() =>
        validateCapabilityGrant(specification, {
          ...noCapabilities,
          writableAreas: [{ area: "current-decomposition", path: "other.md" }],
        }),
      ),
    ).toEqual({
      name: "Error",
      message:
        "Invalid capability grant for designer/decomposition: current-decomposition can grant only decomposition.md",
    });
  });

  test("reports an unknown role/phase without inferring workflow policy", () => {
    expect(thrownValue(() => getRoleSpecification("designer", "accepted"))).toEqual({
      name: "Error",
      message:
        "Unknown role specification designer/accepted; expected designer/decomposition, designer/contracts, critic/decomposition, critic/contracts, critic/implementation, critic/verification, concept-worker/implementation, application-worker/implementation, frontend-worker/implementation, evidence-worker/evidence",
    });
  });
});
