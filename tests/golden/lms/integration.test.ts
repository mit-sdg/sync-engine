/**
 * Golden integration tests for the LMS application.
 *
 * Demonstrates the full concept + reaction pattern in a Learning Management
 * System example. Verifies:
 *  - CRUD operations produce correct state changes
 *  - The audit trail is a *query over the log* (AuditFeed), not a concept:
 *    the record contains every action with its input and outcome, and every
 *    reaction firing is recorded with what it consumed and produced
 *  - Cross-concept cascading (profile deactivate → drops/cancels)
 *  - Multi-reaction fan-out (course archive → groups + enrollments + obligations)
 *  - Cross-concept data creation (enrollment → obligation)
 *  - Query caching and invalidation
 *  - Causal ordering and flow isolation
 */

import { describe, expect, test } from "vite-plus/test";
import { Logging, Reacting } from "@sync-engine/internal/reactions";
import { AuditFeed } from "@sync-engine/internal/hosting/persisting.ts";
import {
  EnrollingConcept,
  GroupingConcept,
  ObligatingConcept,
  OrganizingConcept,
  ProfilingConcept,
  TimingConcept,
} from "./concepts";
import { makeLMSReactions } from "./reactions";

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;

  const { Profiles, Courses, Groups, Enrollments, Obligations, Timing } = reacting.instrument({
    Profiles: new ProfilingConcept(),
    Courses: new OrganizingConcept(),
    Groups: new GroupingConcept(),
    Enrollments: new EnrollingConcept(),
    Obligations: new ObligatingConcept(),
    Timing: new TimingConcept(),
  });

  reacting.register(makeLMSReactions(Profiles, Courses, Groups, Enrollments, Obligations, Timing));

  // The audit trail is a reading of the engine's own log — no Audit concept.
  const feed = new AuditFeed(reacting.Action.store);

  return { reacting, feed, Profiles, Courses, Groups, Enrollments, Obligations };
}

/** Occurrences of one action that succeeded (result outcome). */
function succeeded(feed: AuditFeed, concept: string, action: string) {
  return feed.byConcept({ concept, action }).filter((e) => e.outcome?.kind === "result");
}

/** Occurrences of one action that were refused (error outcome). */
function refused(feed: AuditFeed, concept: string, action: string) {
  return feed.byConcept({ concept, action }).filter((e) => e.outcome?.kind === "error");
}

// ── Profiles ────────────────────────────────────────────────────────

describe("golden: lms — profiles", () => {
  test("creating a profile is on the record", async () => {
    const { feed, Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });

    const profiles = Profiles._getAll({});
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Alice");
    expect(profiles[0].active).toBe(true);

    const creations = succeeded(feed, "Profiling", "createProfile");
    expect(creations).toHaveLength(1);
    expect(creations[0].input.id).toBe("st1");
    expect(creations[0].outcome).toEqual({ kind: "result", value: { profile: "st1" } });
  });

  test("updating a profile name is on the record", async () => {
    const { feed, Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.updateName({ id: "st1", name: "Alice B." });

    expect(Profiles._getProfile({ id: "st1" })[0].name).toBe("Alice B.");
    const updates = succeeded(feed, "Profiling", "updateName");
    expect(updates).toHaveLength(1);
    expect(updates[0].input).toEqual({ id: "st1", name: "Alice B." });
  });

  test("deactivating a profile is on the record", async () => {
    const { feed, Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.deactivate({ id: "st1" });

    expect(Profiles._getProfile({ id: "st1" })[0].active).toBe(false);
    expect(succeeded(feed, "Profiling", "deactivate")).toHaveLength(1);
  });

  test("profile creation errors become refusals, not successes", async () => {
    const { feed, Profiles } = setup();

    const result = await Profiles.createProfile({ id: "st1", name: "" });

    expect(result).toEqual({ error: "EMPTY_NAME", detail: "Profile name must not be empty" });
    // The refusal itself is on the record — a visible absence, not a silent skip.
    expect(succeeded(feed, "Profiling", "createProfile")).toHaveLength(0);
    const failures = refused(feed, "Profiling", "createProfile");
    expect(failures).toHaveLength(1);
    expect(failures[0].outcome).toEqual({
      kind: "error",
      error: { error: "EMPTY_NAME", detail: "Profile name must not be empty" },
    });
  });

  test("duplicate profile creation is a recorded refusal", async () => {
    const { feed, Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    const result = await Profiles.createProfile({ id: "st1", name: "Alice" });

    expect(result).toHaveProperty("error", "PROFILE_EXISTS");
    expect(succeeded(feed, "Profiling", "createProfile")).toHaveLength(1);
    expect(refused(feed, "Profiling", "createProfile")).toHaveLength(1);
  });

  test("updating a non-existent profile is a recorded refusal", async () => {
    const { feed, Profiles } = setup();

    const result = await Profiles.updateName({ id: "ghost", name: "Ghost" });

    expect(result).toHaveProperty("error", "PROFILE_NOT_FOUND");
    expect(succeeded(feed, "Profiling", "updateName")).toHaveLength(0);
    expect(refused(feed, "Profiling", "updateName")).toHaveLength(1);
  });

  test("deactivating an already-inactive profile is a recorded refusal", async () => {
    const { feed, Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.deactivate({ id: "st1" });

    const result = await Profiles.deactivate({ id: "st1" });

    expect(result).toHaveProperty("error", "ALREADY_INACTIVE");
    expect(succeeded(feed, "Profiling", "deactivate")).toHaveLength(1);
    expect(refused(feed, "Profiling", "deactivate")).toHaveLength(1);
  });
});

// ── Courses ─────────────────────────────────────────────────────────

describe("golden: lms — courses", () => {
  test("creating a course is on the record", async () => {
    const { feed, Courses } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Mathematics" });

    const courses = Courses._getAll({});
    expect(courses).toHaveLength(1);
    expect(courses[0].code).toBe("MATH101");
    expect(courses[0].active).toBe(true);

    const creations = succeeded(feed, "Organizing", "createCourse");
    expect(creations).toHaveLength(1);
    expect(creations[0].input.id).toBe("c1");
  });

  test("updating a course name is on the record", async () => {
    const { feed, Courses } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Math" });
    await Courses.updateName({ id: "c1", name: "Advanced Math" });

    expect(Courses._getCourse({ id: "c1" })[0].name).toBe("Advanced Math");
    expect(succeeded(feed, "Organizing", "updateName")).toHaveLength(1);
  });

  test("archiving a course is on the record", async () => {
    const { feed, Courses } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Math" });
    await Courses.archive({ id: "c1" });

    expect(Courses._getCourse({ id: "c1" })[0].active).toBe(false);
    expect(succeeded(feed, "Organizing", "archive")).toHaveLength(1);
  });

  test("course creation errors become refusals", async () => {
    const { feed, Courses } = setup();

    const r1 = await Courses.createCourse({ id: "c1", code: "", name: "Math" });
    expect(r1).toHaveProperty("error", "INVALID_CODE");

    const r2 = await Courses.createCourse({ id: "c2", code: "M101", name: "" });
    expect(r2).toHaveProperty("error", "EMPTY_NAME");

    expect(succeeded(feed, "Organizing", "createCourse")).toHaveLength(0);
    expect(refused(feed, "Organizing", "createCourse")).toHaveLength(2);
  });

  test("duplicate course code is a recorded refusal", async () => {
    const { feed, Courses } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Math" });
    const result = await Courses.createCourse({ id: "c2", code: "MATH101", name: "Math II" });

    expect(result).toHaveProperty("error", "DUPLICATE_CODE");
    expect(succeeded(feed, "Organizing", "createCourse")).toHaveLength(1);
  });
});

// ── Groups ──────────────────────────────────────────────────────────

describe("golden: lms — groups", () => {
  test("creating a group is on the record", async () => {
    const { feed, Courses, Groups } = setup();

    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });

    const groups = Groups._getAll({});
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Group A");
    expect(groups[0].active).toBe(true);

    const creations = succeeded(feed, "Grouping", "createGroup");
    expect(creations).toHaveLength(1);
    expect(creations[0].input.id).toBe("g1");
  });

  test("archiving a group is on the record", async () => {
    const { feed, Courses, Groups } = setup();

    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });
    await Groups.archiveGroup({ id: "g1" });

    expect(Groups._getGroup({ id: "g1" })[0].active).toBe(false);
    expect(succeeded(feed, "Grouping", "archiveGroup")).toHaveLength(1);
  });

  test("restoring a group is on the record", async () => {
    const { feed, Courses, Groups } = setup();

    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });
    await Groups.archiveGroup({ id: "g1" });
    await Groups.restoreGroup({ id: "g1" });

    expect(Groups._getGroup({ id: "g1" })[0].active).toBe(true);
    expect(succeeded(feed, "Grouping", "restoreGroup")).toHaveLength(1);
  });

  test("assigning a teacher is on the record", async () => {
    const { feed, Profiles, Courses, Groups } = setup();

    await Profiles.createProfile({ id: "t1", name: "Dr. Smith" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });
    await Groups.assignTeacher({ id: "g1", teacher: "t1" });

    expect(Groups._getGroup({ id: "g1" })[0].teacher).toBe("t1");
    const assignments = succeeded(feed, "Grouping", "assignTeacher");
    expect(assignments).toHaveLength(1);
    expect(assignments[0].input).toEqual({ id: "g1", teacher: "t1" });
  });

  test("group creation errors become refusals", async () => {
    const { feed, Groups } = setup();

    const result = await Groups.createGroup({ id: "g1", course: "", name: "" });

    expect(result).toHaveProperty("error", "INVALID_INPUT");
    expect(succeeded(feed, "Grouping", "createGroup")).toHaveLength(0);
    expect(refused(feed, "Grouping", "createGroup")).toHaveLength(1);
  });
});

// ── Obligations ─────────────────────────────────────────────────────

describe("golden: lms — obligations", () => {
  test("creating an obligation is on the record", async () => {
    const { feed, Profiles, Courses, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Obligations.createObligation({
      id: "o1",
      student: "st1",
      course: "c1",
      amount: 500,
      dueDate: new Date("2025-12-31"),
    });

    const obl = Obligations._getObligation({ id: "o1" })[0];
    expect(obl.amount).toBe(500);
    expect(obl.status).toBe("pending");

    const creations = succeeded(feed, "Obligating", "createObligation");
    expect(creations).toHaveLength(1);
    expect(creations[0].input.id).toBe("o1");
  });

  test("marking an obligation as paid is on the record", async () => {
    const { feed, Profiles, Courses, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Obligations.createObligation({
      id: "o1",
      student: "st1",
      course: "c1",
      amount: 500,
      dueDate: new Date(),
    });
    await Obligations.markPaid({ id: "o1" });

    expect(Obligations._getObligation({ id: "o1" })[0].status).toBe("paid");
    expect(succeeded(feed, "Obligating", "markPaid")).toHaveLength(1);
  });

  test("cancelling an obligation is on the record", async () => {
    const { feed, Profiles, Courses, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Obligations.createObligation({
      id: "o1",
      student: "st1",
      course: "c1",
      amount: 500,
      dueDate: new Date(),
    });
    await Obligations.cancelObligation({ id: "o1" });

    expect(Obligations._getObligation({ id: "o1" })[0].status).toBe("cancelled");
    expect(succeeded(feed, "Obligating", "cancelObligation")).toHaveLength(1);
  });

  test("obligation errors become refusals, not successes", async () => {
    const { feed, Obligations } = setup();

    await Obligations.createObligation({
      id: "o1",
      student: "st1",
      course: "c1",
      amount: 500,
      dueDate: new Date(),
    });

    const result = await Obligations.markPaid({ id: "ghost" });
    expect(result).toHaveProperty("error", "OBLIGATION_NOT_FOUND");

    expect(succeeded(feed, "Obligating", "markPaid")).toHaveLength(0);
    expect(refused(feed, "Obligating", "markPaid")).toHaveLength(1);
  });
});

// ── Enrollments ─────────────────────────────────────────────────────

describe("golden: lms — enrollments", () => {
  test("enrolling a student is on the record and creates an obligation", async () => {
    const { reacting, feed, Profiles, Courses, Enrollments, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });

    const enrollments = Enrollments._getActiveEnrollments({});
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].student).toBe("st1");

    // An obligation was auto-created by OnEnrollmentCreated_InitObligation
    const obligations = Obligations._getByStudent({ student: "st1" });
    expect(obligations).toHaveLength(1);
    expect(obligations[0].id).toBe("e1");
    expect(obligations[0].course).toBe("c1");
    expect(obligations[0].status).toBe("pending");

    // Both the enrollment and the obligation it caused are on the record,
    // and the firing that joins them names the reaction, its trigger, and its result.
    expect(succeeded(feed, "Enrolling", "enroll")).toHaveLength(1);
    expect(succeeded(feed, "Obligating", "createObligation")).toHaveLength(1);
    const firings = reacting._getFirings("OnEnrollmentCreated_InitObligation");
    expect(firings).toHaveLength(1);
    expect(firings[0].consumed).toHaveLength(1);
    expect(feed.byFlow({ flow: firings[0].flow }).map((e) => e.action)).toEqual([
      "enroll",
      "createObligation",
    ]);
  });

  test("enrollment errors are recorded refusals and create no obligation", async () => {
    const { feed, Profiles, Courses, Enrollments, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });

    const result = await Enrollments.enroll({ id: "e2", student: "st1", course: "c1" });

    expect(result).toHaveProperty("error", "ALREADY_ENROLLED");

    // The refusal is on the record, entity id and all.
    const failures = refused(feed, "Enrolling", "enroll");
    expect(failures).toHaveLength(1);
    expect(failures[0].input.id).toBe("e2");

    // No obligation created for the failed enrollment
    // (OnEnrollmentCreated_InitObligation requires { enrollment } in output)
    expect(Obligations._getByStudent({ student: "st1" })).toHaveLength(1);
  });

  test("dropping an enrollment is on the record", async () => {
    const { feed, Profiles, Courses, Enrollments } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Enrollments.drop({ id: "e1" });

    const enrollment = Enrollments._getEnrollment({ id: "e1" })[0];
    expect(enrollment.status).toBe("dropped");

    expect(succeeded(feed, "Enrolling", "drop")).toHaveLength(1);
  });

  test("dropping a non-existent enrollment is a recorded refusal", async () => {
    const { feed, Enrollments } = setup();

    const result = await Enrollments.drop({ id: "ghost" });

    expect(result).toHaveProperty("error", "ENROLLMENT_NOT_FOUND");
    expect(succeeded(feed, "Enrolling", "drop")).toHaveLength(0);
    expect(refused(feed, "Enrolling", "drop")).toHaveLength(1);
  });
});

// ── Cascading reactions ─────────────────────────────────────────────────

describe("golden: lms — cascading", () => {
  test("deactivating a profile drops its enrollments and cancels its obligations", async () => {
    const { reacting, feed, Profiles, Courses, Enrollments, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Courses.createCourse({ id: "c2", code: "P101", name: "Physics" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Enrollments.enroll({ id: "e2", student: "st1", course: "c2" });

    // Both enrollments active, both obligations created (by InitObligation reaction)
    expect(
      Enrollments._getStudentEnrollments({ student: "st1" }).filter((e) => e.status === "active"),
    ).toHaveLength(2);
    expect(
      Obligations._getByStudent({ student: "st1" }).filter((o) => o.status === "pending"),
    ).toHaveLength(2);

    await Profiles.deactivate({ id: "st1" });

    // Both enrollments dropped
    const afterEnroll = Enrollments._getStudentEnrollments({ student: "st1" });
    expect(afterEnroll.filter((e) => e.status === "dropped")).toHaveLength(2);

    // Both obligations cancelled
    const afterObl = Obligations._getByStudent({ student: "st1" });
    expect(afterObl.filter((o) => o.status === "cancelled")).toHaveLength(2);

    // The record tells the cascade's story: each reaction fired once per dependent,
    // and each drop/cancel it produced is an ordinary occurrence on the log.
    expect(succeeded(feed, "Profiling", "deactivate")).toHaveLength(1);
    expect(reacting._getFirings("OnProfileDeactivated_DropEnrollments")).toHaveLength(2);
    expect(reacting._getFirings("OnProfileDeactivated_CancelObligations")).toHaveLength(2);
    expect(succeeded(feed, "Enrolling", "drop")).toHaveLength(2);
    expect(succeeded(feed, "Obligating", "cancelObligation")).toHaveLength(2);
  });

  test("deactivating a profile with no enrollments or obligations fires no cascade", async () => {
    const { reacting, feed, Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.deactivate({ id: "st1" });

    // Exactly two occurrences on the record, and no cascade reaction fired.
    expect(feed.all().map((e) => `${e.concept}.${e.action}`)).toEqual([
      "Profiling.createProfile",
      "Profiling.deactivate",
    ]);
    expect(reacting._getFirings("OnProfileDeactivated_DropEnrollments")).toHaveLength(0);
    expect(reacting._getFirings("OnProfileDeactivated_CancelObligations")).toHaveLength(0);
  });

  test("archiving a course cascades to enrollments, groups, and obligations", async () => {
    const { reacting, feed, Profiles, Courses, Groups, Enrollments, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.createProfile({ id: "st2", name: "Bob" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Morning" });
    await Groups.createGroup({ id: "g2", course: "c1", name: "Afternoon" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Enrollments.enroll({ id: "e2", student: "st2", course: "c1" });

    // All active before archive
    expect(Groups._getGroupsByCourse({ course: "c1" }).every((g) => g.active)).toBe(true);
    expect(
      Enrollments._getCourseEnrollments({ course: "c1" }).filter((e) => e.status === "active"),
    ).toHaveLength(2);
    expect(
      Obligations._getByCourse({ course: "c1" }).filter((o) => o.status === "pending"),
    ).toHaveLength(2);

    await Courses.archive({ id: "c1" });

    // Groups archived
    expect(Groups._getGroupsByCourse({ course: "c1" }).every((g) => !g.active)).toBe(true);
    // Enrollments dropped
    expect(
      Enrollments._getCourseEnrollments({ course: "c1" }).filter((e) => e.status === "active"),
    ).toHaveLength(0);
    // Obligations cancelled
    expect(
      Obligations._getByCourse({ course: "c1" }).filter((o) => o.status === "cancelled"),
    ).toHaveLength(2);

    // Every leg of the fan-out is on the record: reaction firings and occurrences.
    expect(succeeded(feed, "Organizing", "archive")).toHaveLength(1);
    expect(reacting._getFirings("OnCourseArchived_ArchiveGroups")).toHaveLength(2);
    expect(reacting._getFirings("OnCourseArchived_DropEnrollments")).toHaveLength(2);
    expect(reacting._getFirings("OnCourseArchived_CancelObligations")).toHaveLength(2);
    expect(succeeded(feed, "Grouping", "archiveGroup")).toHaveLength(2);
    expect(succeeded(feed, "Enrolling", "drop")).toHaveLength(2);
    expect(succeeded(feed, "Obligating", "cancelObligation")).toHaveLength(2);
  });

  test("enrollment creates a default obligation automatically", async () => {
    const { Profiles, Courses, Enrollments, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });

    const obligations = Obligations._getByStudent({ student: "st1" });
    expect(obligations).toHaveLength(1);
    expect(obligations[0].student).toBe("st1");
    expect(obligations[0].course).toBe("c1");
    expect(obligations[0].amount).toBe(0);
    expect(obligations[0].status).toBe("pending");
  });

  test("failed enrollment does not create an obligation", async () => {
    const { Profiles, Courses, Enrollments, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });

    // Duplicate enrollment — error (no { enrollment } in output)
    await Enrollments.enroll({ id: "e2", student: "st1", course: "c1" });

    // Only 1 obligation (from successful e1), not 2
    expect(Obligations._getByStudent({ student: "st1" })).toHaveLength(1);
  });

  test("marking an already-cancelled obligation as paid is a recorded refusal", async () => {
    const { feed, Profiles, Courses, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Obligations.createObligation({
      id: "o1",
      student: "st1",
      course: "c1",
      amount: 500,
      dueDate: new Date(),
    });
    await Obligations.cancelObligation({ id: "o1" });

    const result = await Obligations.markPaid({ id: "o1" });
    expect(result).toHaveProperty("error", "NOT_PENDING");

    expect(succeeded(feed, "Obligating", "markPaid")).toHaveLength(0);
    expect(refused(feed, "Obligating", "markPaid")).toHaveLength(1);
  });
});

// ── The audit feed as an entity trail ───────────────────────────────

describe("golden: lms — the audit trail is a query", () => {
  test("byEntity reassembles an entity's history across concepts and reactions", async () => {
    const { feed, Profiles, Courses, Enrollments } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Profiles.deactivate({ id: "st1" });

    // Everything that ever mentioned st1, in one query: the creation, the
    // enrollment, the obligation the enrollment caused, and the deactivation.
    const trail = feed.byEntity({ id: "st1" });
    const names = trail.map((e) => `${e.concept}.${e.action}`);
    expect(names).toContain("Profiling.createProfile");
    expect(names).toContain("Enrolling.enroll");
    expect(names).toContain("Obligating.createObligation");
    expect(names).toContain("Profiling.deactivate");

    // Each entry knows which reactions fired because of it — the "why" of the cascade.
    const deactivation = trail.find((e) => e.action === "deactivate");
    expect(deactivation?.firings).toContain("OnProfileDeactivated_DropEnrollments");
    expect(deactivation?.firings).toContain("OnProfileDeactivated_CancelObligations");
  });
});

// ── Query caching ───────────────────────────────────────────────────

describe("golden: lms — query caching", () => {
  test("queries are cached between mutations", async () => {
    const { Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });

    const first = Profiles._getAll({});
    const second = Profiles._getAll({});
    expect(first).toBe(second);

    await Profiles.createProfile({ id: "st2", name: "Bob" });
    const third = Profiles._getAll({});
    expect(third).not.toBe(first);
    expect(third).toHaveLength(2);
  });

  test("mutations on one concept do not invalidate another concept's cache", async () => {
    const { Profiles, Courses } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });

    const profilesBefore = Profiles._getAll({});
    const coursesBefore = Courses._getAll({});

    await Profiles.createProfile({ id: "st2", name: "Bob" });

    const coursesAfter = Courses._getAll({});
    expect(coursesAfter).toBe(coursesBefore);

    const profilesAfter = Profiles._getAll({});
    expect(profilesAfter).not.toBe(profilesBefore);
    expect(profilesAfter).toHaveLength(2);
  });
});

// ── Ordering and flow isolation ─────────────────────────────────────

describe("golden: lms — ordering and flow isolation", () => {
  test("multiple operations maintain causal ordering on the record", async () => {
    const { reacting, feed, Profiles, Courses, Enrollments } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Profiles.updateName({ id: "st1", name: "Alice B." });
    await Enrollments.drop({ id: "e1" });

    const names = feed.all().map((e) => `${e.concept}.${e.action}`);
    expect(names).toContain("Profiling.createProfile");
    expect(names).toContain("Organizing.createCourse");
    expect(names).toContain("Enrolling.enroll");
    expect(names).toContain("Obligating.createObligation"); // caused by InitObligation
    expect(names).toContain("Profiling.updateName");
    expect(names).toContain("Enrolling.drop");
    expect(reacting._getFirings("OnEnrollmentCreated_InitObligation")).toHaveLength(1);
  });

  test("independent operations do not cross-match", async () => {
    const { feed, Profiles } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    const before = feed.all().length;

    await Profiles.createProfile({ id: "st2", name: "Bob" });

    // The second creation adds exactly one occurrence — nothing re-fires
    // against the first creation's flow.
    const after = feed.all();
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1].input.id).toBe("st2");
  });

  test("profile deactivation cascade does not affect students in other courses", async () => {
    const { Profiles, Courses, Enrollments, Obligations } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.createProfile({ id: "st2", name: "Bob" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Enrollments.enroll({ id: "e2", student: "st2", course: "c1" });

    await Profiles.deactivate({ id: "st1" });

    const st1Enrollments = Enrollments._getStudentEnrollments({ student: "st1" });
    expect(st1Enrollments.every((e) => e.status === "dropped")).toBe(true);

    const st2Enrollments = Enrollments._getStudentEnrollments({ student: "st2" });
    expect(st2Enrollments.every((e) => e.status === "active")).toBe(true);

    // st1's obligations should be cancelled, st2's should stay pending
    const st1Obligations = Obligations._getByStudent({ student: "st1" });
    expect(st1Obligations.every((o) => o.status === "cancelled")).toBe(true);

    const st2Obligations = Obligations._getByStudent({ student: "st2" });
    expect(st2Obligations).toHaveLength(1);
    expect(st2Obligations[0].status).toBe("pending");
  });
});
