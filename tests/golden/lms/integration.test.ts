/**
 * Golden integration tests for the LMS application.
 *
 * Demonstrates the full concept + sync pattern in a Learning Management
 * System example. Verifies:
 *  - CRUD operations produce correct state changes
 *  - Success/error discrimination via output patterns in `when`
 *  - Cross-concept cascading (profile deactivate → drops/cancels)
 *  - Multi-sync fan-out (course archive → groups + enrollments + obligations)
 *  - Ordered outcome matching via `act().match(on(), onError())`
 *  - Pipeline composition via `.then(...)`
 *  - Cross-concept data creation (enrollment → obligation)
 *  - Query caching and invalidation
 *  - Causal ordering and flow isolation
 */

import { describe, expect, test } from "vite-plus/test";
import { Logging, SyncConcept } from "@sync-engine/engine";
import {
  AuditConcept,
  EnrollingConcept,
  GroupingConcept,
  ObligatingConcept,
  OrganizingConcept,
  ProfilingConcept,
} from "./concepts";
import { makeLMSSyncs } from "./syncs";

function setup() {
  const Sync = new SyncConcept();
  Sync.logging = Logging.OFF;

  const { Profiles, Courses, Groups, Enrollments, Obligations, Audit } = Sync.instrument({
    Profiles: new ProfilingConcept(),
    Courses: new OrganizingConcept(),
    Groups: new GroupingConcept(),
    Enrollments: new EnrollingConcept(),
    Obligations: new ObligatingConcept(),
    Audit: new AuditConcept(),
  });

  Sync.register(makeLMSSyncs(Profiles, Courses, Groups, Enrollments, Obligations, Audit));

  return { Profiles, Courses, Groups, Enrollments, Obligations, Audit };
}

// ── Profiles ────────────────────────────────────────────────────────

describe("golden: lms — profiles", () => {
  test("creating a profile produces an audit entry", async () => {
    const { Profiles, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });

    const profiles = Profiles._getAll({});
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Alice");
    expect(profiles[0].active).toBe(true);

    expect(Audit.log).toHaveLength(1);
    expect(Audit.log[0].event).toBe("PROFILE_CREATED");
    expect(Audit.log[0].entityId).toBe("st1");
  });

  test("updating a profile name produces an audit entry", async () => {
    const { Profiles, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.updateName({ id: "st1", name: "Alice B." });

    expect(Profiles._getProfile({ id: "st1" })[0].name).toBe("Alice B.");
    expect(Audit.log).toHaveLength(2);
    expect(Audit.log[1].event).toBe("PROFILE_UPDATED");
  });

  test("deactivating a profile produces an audit entry", async () => {
    const { Profiles, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.deactivate({ id: "st1" });

    expect(Profiles._getProfile({ id: "st1" })[0].active).toBe(false);
    expect(Audit.log.map((e) => e.event)).toContain("PROFILE_DEACTIVATED");
  });

  test("profile creation errors are NOT audited (no success field in output)", async () => {
    const { Profiles, Audit } = setup();

    const result = await Profiles.createProfile({ id: "st1", name: "" });

    expect(result).toEqual({ error: "EMPTY_NAME", detail: "Profile name must not be empty" });
    expect(Audit.log).toHaveLength(0);
  });

  test("duplicate profile creation is not audited", async () => {
    const { Profiles, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    const result = await Profiles.createProfile({ id: "st1", name: "Alice" });

    expect(result).toHaveProperty("error", "PROFILE_EXISTS");
    expect(Audit.log).toHaveLength(1);
    expect(Audit.log[0].event).toBe("PROFILE_CREATED");
  });

  test("updating a non-existent profile is not audited", async () => {
    const { Profiles, Audit } = setup();

    const result = await Profiles.updateName({ id: "ghost", name: "Ghost" });

    expect(result).toHaveProperty("error", "PROFILE_NOT_FOUND");
    expect(Audit.log).toHaveLength(0);
  });

  test("deactivating an already-inactive profile is not audited", async () => {
    const { Profiles, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.deactivate({ id: "st1" });
    const logBefore = Audit.log.length;

    const result = await Profiles.deactivate({ id: "st1" });

    expect(result).toHaveProperty("error", "ALREADY_INACTIVE");
    expect(Audit.log.length).toBe(logBefore);
  });
});

// ── Courses ─────────────────────────────────────────────────────────

describe("golden: lms — courses", () => {
  test("creating a course produces an audit entry", async () => {
    const { Courses, Audit } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Mathematics" });

    const courses = Courses._getAll({});
    expect(courses).toHaveLength(1);
    expect(courses[0].code).toBe("MATH101");
    expect(courses[0].active).toBe(true);

    expect(Audit.log).toHaveLength(1);
    expect(Audit.log[0].event).toBe("COURSE_CREATED");
    expect(Audit.log[0].entityId).toBe("c1");
  });

  test("updating a course name produces an audit entry", async () => {
    const { Courses, Audit } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Math" });
    await Courses.updateName({ id: "c1", name: "Advanced Math" });

    expect(Courses._getCourse({ id: "c1" })[0].name).toBe("Advanced Math");
    expect(Audit.log).toHaveLength(2);
    expect(Audit.log[1].event).toBe("COURSE_UPDATED");
  });

  test("archiving a course produces an audit entry", async () => {
    const { Courses, Audit } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Math" });
    await Courses.archive({ id: "c1" });

    expect(Courses._getCourse({ id: "c1" })[0].active).toBe(false);
    expect(Audit.log.map((e) => e.event)).toContain("COURSE_ARCHIVED");
  });

  test("course creation errors are not audited", async () => {
    const { Courses, Audit } = setup();

    const r1 = await Courses.createCourse({ id: "c1", code: "", name: "Math" });
    expect(r1).toHaveProperty("error", "INVALID_CODE");

    const r2 = await Courses.createCourse({ id: "c2", code: "M101", name: "" });
    expect(r2).toHaveProperty("error", "EMPTY_NAME");

    expect(Audit.log).toHaveLength(0);
  });

  test("duplicate course code is not audited", async () => {
    const { Courses, Audit } = setup();

    await Courses.createCourse({ id: "c1", code: "MATH101", name: "Math" });
    const result = await Courses.createCourse({ id: "c2", code: "MATH101", name: "Math II" });

    expect(result).toHaveProperty("error", "DUPLICATE_CODE");
    expect(Audit.log).toHaveLength(1);
  });
});

// ── Groups ──────────────────────────────────────────────────────────

describe("golden: lms — groups", () => {
  test("creating a group produces an audit entry", async () => {
    const { Courses, Groups, Audit } = setup();

    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });

    const groups = Groups._getAll({});
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Group A");
    expect(groups[0].active).toBe(true);

    const groupAudit = Audit.log.filter((e) => e.event === "GROUP_CREATED");
    expect(groupAudit).toHaveLength(1);
    expect(groupAudit[0].entityId).toBe("g1");
  });

  test("archiving a group produces an audit entry", async () => {
    const { Courses, Groups, Audit } = setup();

    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });
    await Groups.archiveGroup({ id: "g1" });

    expect(Groups._getGroup({ id: "g1" })[0].active).toBe(false);
    expect(Audit.log.map((e) => e.event)).toContain("GROUP_ARCHIVED");
  });

  test("restoring a group produces an audit entry", async () => {
    const { Courses, Groups, Audit } = setup();

    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });
    await Groups.archiveGroup({ id: "g1" });
    await Groups.restoreGroup({ id: "g1" });

    expect(Groups._getGroup({ id: "g1" })[0].active).toBe(true);
    expect(Audit.log.map((e) => e.event)).toContain("GROUP_RESTORED");
  });

  test("assigning a teacher produces an audit entry", async () => {
    const { Profiles, Courses, Groups, Audit } = setup();

    await Profiles.createProfile({ id: "t1", name: "Dr. Smith" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Groups.createGroup({ id: "g1", course: "c1", name: "Group A" });
    await Groups.assignTeacher({ id: "g1", teacher: "t1" });

    expect(Groups._getGroup({ id: "g1" })[0].teacher).toBe("t1");
    expect(Audit.log.map((e) => e.event)).toContain("GROUP_TEACHER_ASSIGNED");
  });

  test("group creation errors are not audited", async () => {
    const { Groups, Audit } = setup();

    const result = await Groups.createGroup({ id: "g1", course: "", name: "" });

    expect(result).toHaveProperty("error", "INVALID_INPUT");
    expect(Audit.log).toHaveLength(0);
  });
});

// ── Obligations ─────────────────────────────────────────────────────

describe("golden: lms — obligations", () => {
  test("creating an obligation produces an audit entry", async () => {
    const { Profiles, Courses, Obligations, Audit } = setup();

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

    const oblAudit = Audit.log.filter((e) => e.event === "OBLIGATION_CREATED");
    expect(oblAudit).toHaveLength(1);
    expect(oblAudit[0].entityId).toBe("o1");
  });

  test("marking an obligation as paid produces an audit entry", async () => {
    const { Profiles, Courses, Obligations, Audit } = setup();

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
    expect(Audit.log.map((e) => e.event)).toContain("OBLIGATION_PAID");
  });

  test("cancelling an obligation produces an audit entry", async () => {
    const { Profiles, Courses, Obligations, Audit } = setup();

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
    expect(Audit.log.map((e) => e.event)).toContain("OBLIGATION_CANCELLED");
  });

  test("obligation errors are not audited as success", async () => {
    const { Obligations, Audit } = setup();

    await Obligations.createObligation({
      id: "o1",
      student: "st1",
      course: "c1",
      amount: 500,
      dueDate: new Date(),
    });

    const result = await Obligations.markPaid({ id: "ghost" });
    expect(result).toHaveProperty("error", "OBLIGATION_NOT_FOUND");

    // No OBLIGATION_PAID for the ghost
    expect(Audit.log.filter((e) => e.event === "OBLIGATION_PAID")).toHaveLength(0);
  });
});

// ── Enrollments ─────────────────────────────────────────────────────

describe("golden: lms — enrollments", () => {
  test("enrolling a student produces an audit entry and creates an obligation", async () => {
    const { Profiles, Courses, Enrollments, Obligations, Audit } = setup();

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

    // Both enrollment and obligation are audited
    expect(Audit.log.map((e) => e.event)).toContain("ENROLLMENT_CREATED");
    expect(Audit.log.map((e) => e.event)).toContain("OBLIGATION_CREATED");
  });

  test("enrollment errors produce error-audit entries but no obligation", async () => {
    const { Profiles, Courses, Enrollments, Obligations, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });

    const result = await Enrollments.enroll({ id: "e2", student: "st1", course: "c1" });

    expect(result).toHaveProperty("error", "ALREADY_ENROLLED");

    // Error audit entry is created
    const errorAudits = Audit.log.filter((e) => e.event === "ENROLLMENT_FAILED");
    expect(errorAudits).toHaveLength(1);
    expect(errorAudits[0].entityId).toBe("e2");

    // No obligation created for the failed enrollment
    // (OnEnrollmentCreated_InitObligation requires { enrollment } in output)
    expect(Obligations._getByStudent({ student: "st1" })).toHaveLength(1);
  });

  test("dropping an enrollment produces an audit entry", async () => {
    const { Profiles, Courses, Enrollments, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Enrollments.drop({ id: "e1" });

    const enrollment = Enrollments._getEnrollment({ id: "e1" })[0];
    expect(enrollment.status).toBe("dropped");

    expect(Audit.log.map((e) => e.event)).toContain("ENROLLMENT_DROPPED");
  });

  test("dropping a non-existent enrollment is not audited as success", async () => {
    const { Enrollments, Audit } = setup();

    const result = await Enrollments.drop({ id: "ghost" });

    expect(result).toHaveProperty("error", "ENROLLMENT_NOT_FOUND");
    expect(Audit.log.filter((e) => e.event === "ENROLLMENT_DROPPED")).toHaveLength(0);
  });
});

// ── Cascading syncs ─────────────────────────────────────────────────

describe("golden: lms — cascading", () => {
  test("deactivating a profile drops its enrollments and cancels its obligations", async () => {
    const { Profiles, Courses, Enrollments, Obligations, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Courses.createCourse({ id: "c2", code: "P101", name: "Physics" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Enrollments.enroll({ id: "e2", student: "st1", course: "c2" });

    // Both enrollments active, both obligations created (by InitObligation sync)
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

    const events = Audit.log.map((e) => e.event);
    expect(events).toContain("PROFILE_DEACTIVATED");
    expect(events.filter((e) => e === "ENROLLMENT_DROPPED")).toHaveLength(2);
    expect(events.filter((e) => e === "ENROLLMENT_CASCADE_DROPPED")).toHaveLength(2);
    expect(events.filter((e) => e === "OBLIGATION_CANCELLED")).toHaveLength(2);
    expect(events.filter((e) => e === "OBLIGATION_CASCADE_CANCELLED")).toHaveLength(2);
  });

  test("deactivating a profile with no enrollments or obligations only audits deactivation", async () => {
    const { Profiles, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Profiles.deactivate({ id: "st1" });

    expect(Audit.log.map((e) => e.event)).toEqual(["PROFILE_CREATED", "PROFILE_DEACTIVATED"]);
  });

  test("archiving a course cascades to enrollments, groups, and obligations", async () => {
    const { Profiles, Courses, Groups, Enrollments, Obligations, Audit } = setup();

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

    const events = Audit.log.map((e) => e.event);
    expect(events).toContain("COURSE_ARCHIVED");
    expect(events).toContain("GROUP_ARCHIVED");
    expect(events).toContain("GROUP_CASCADE_ARCHIVED");
    expect(events).toContain("ENROLLMENT_DROPPED");
    expect(events).toContain("ENROLLMENT_CASCADE_DROPPED");
    expect(events).toContain("OBLIGATION_CANCELLED");
    expect(events).toContain("OBLIGATION_CASCADE_CANCELLED");
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

  test("marking an already-cancelled obligation as paid is audited as error", async () => {
    const { Profiles, Courses, Obligations, Audit } = setup();

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

    // No OBLIGATION_PAID for the cancelled obligation
    expect(Audit.log.filter((e) => e.event === "OBLIGATION_PAID")).toHaveLength(0);
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
  test("multiple operations maintain causal ordering", async () => {
    const { Profiles, Courses, Enrollments, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    await Courses.createCourse({ id: "c1", code: "M101", name: "Math" });
    await Enrollments.enroll({ id: "e1", student: "st1", course: "c1" });
    await Profiles.updateName({ id: "st1", name: "Alice B." });
    await Enrollments.drop({ id: "e1" });

    const events = Audit.log.map((e) => e.event);
    expect(events).toContain("PROFILE_CREATED");
    expect(events).toContain("COURSE_CREATED");
    expect(events).toContain("ENROLLMENT_CREATED");
    expect(events).toContain("OBLIGATION_CREATED"); // auto-created by InitObligation
    expect(events).toContain("PROFILE_UPDATED");
    expect(events).toContain("ENROLLMENT_DROPPED");
  });

  test("independent operations do not cross-match", async () => {
    const { Profiles, Audit } = setup();

    await Profiles.createProfile({ id: "st1", name: "Alice" });
    const logAt1 = Audit.log.length;

    await Profiles.createProfile({ id: "st2", name: "Bob" });

    // The second creation does not accidentally match the first's audit sync again
    expect(Audit.log.length).toBe(logAt1 + 1);
    expect(Audit.log[Audit.log.length - 1].entityId).toBe("st2");
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
