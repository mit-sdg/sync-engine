/**
 * Golden test app — a Learning Management System built with the sync-engine
 * concepts + synchronizations pattern.
 *
 * Concepts:
 *  - ProfilingConcept   — student profiles (create, update, deactivate, queries)
 *  - OrganizingConcept   — courses (create, update, archive, queries)
 *  - GroupingConcept     — course groups / classes (create, archive, restore, assign teacher)
 *  - EnrollingConcept    — enrollments (enroll, drop, queries)
 *  - ObligatingConcept   — tuition obligations (create, mark paid, cancel)
 *  - AuditConcept        — immutable audit trail (record, queries)
 *
 * Every concept is a plain TypeScript class. Actions (non-underscore methods)
 * are instrumented by the engine. Queries (_-prefixed methods) are read-only
 * and auto-cached. Concepts never import each other — cross-concept behaviour
 * lives exclusively in syncs.
 */

import type { Empty } from "@sync-engine/engine";

// ── ProfilingConcept ───────────────────────────────────────────────

export interface ProfileItem {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
}

export class ProfilingConcept {
  private profiles = new Map<string, ProfileItem>();

  createProfile({ id, name }: { id: string; name: string }) {
    if (!name || name.trim().length === 0) {
      return { error: "EMPTY_NAME", detail: "Profile name must not be empty" };
    }
    if (this.profiles.has(id)) {
      return { error: "PROFILE_EXISTS", detail: `Profile ${id} already exists` };
    }
    const profile: ProfileItem = { id, name, active: true, createdAt: new Date() };
    this.profiles.set(id, profile);
    return { profile: id };
  }

  updateName({ id, name }: { id: string; name: string }) {
    const profile = this.profiles.get(id);
    if (!profile) return { error: "PROFILE_NOT_FOUND", detail: `Profile ${id} not found` };
    if (!name || name.trim().length === 0) {
      return { error: "EMPTY_NAME", detail: "Profile name must not be empty" };
    }
    profile.name = name;
    return { profile: id };
  }

  deactivate({ id }: { id: string }) {
    const profile = this.profiles.get(id);
    if (!profile) return { error: "PROFILE_NOT_FOUND", detail: `Profile ${id} not found` };
    if (!profile.active) {
      return { error: "ALREADY_INACTIVE", detail: `Profile ${id} is already inactive` };
    }
    profile.active = false;
    return { profile: id };
  }

  _getProfile({ id }: { id: string }): ProfileItem[] {
    const p = this.profiles.get(id);
    return p ? [p] : [];
  }

  _getActiveProfiles(_: Empty): ProfileItem[] {
    return [...this.profiles.values()].filter((p) => p.active);
  }

  _getAll(_: Empty): ProfileItem[] {
    return [...this.profiles.values()];
  }
}

// ── OrganizingConcept ───────────────────────────────────────────────

export interface CourseItem {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: Date;
}

export class OrganizingConcept {
  private courses = new Map<string, CourseItem>();
  private codes = new Set<string>();

  createCourse({ id, code, name }: { id: string; code: string; name: string }) {
    if (!code || code.trim().length === 0) {
      return { error: "INVALID_CODE", detail: "Course code must not be empty" };
    }
    if (!name || name.trim().length === 0) {
      return { error: "EMPTY_NAME", detail: "Course name must not be empty" };
    }
    if (this.codes.has(code)) {
      return { error: "DUPLICATE_CODE", detail: `Course code ${code} already exists` };
    }
    const course: CourseItem = { id, code, name, active: true, createdAt: new Date() };
    this.courses.set(id, course);
    this.codes.add(code);
    return { course: id, code, name };
  }

  updateName({ id, name }: { id: string; name: string }) {
    const course = this.courses.get(id);
    if (!course) return { error: "COURSE_NOT_FOUND", detail: `Course ${id} not found` };
    if (!name || name.trim().length === 0) {
      return { error: "EMPTY_NAME", detail: "Course name must not be empty" };
    }
    course.name = name;
    return { course: id };
  }

  archive({ id }: { id: string }) {
    const course = this.courses.get(id);
    if (!course) return { error: "COURSE_NOT_FOUND", detail: `Course ${id} not found` };
    if (!course.active) {
      return { error: "ALREADY_ARCHIVED", detail: `Course ${id} is already archived` };
    }
    course.active = false;
    return { course: id };
  }

  _getCourse({ id }: { id: string }): CourseItem[] {
    const c = this.courses.get(id);
    return c ? [c] : [];
  }

  _getActiveCourses(_: Empty): CourseItem[] {
    return [...this.courses.values()].filter((c) => c.active);
  }

  _getAll(_: Empty): CourseItem[] {
    return [...this.courses.values()];
  }
}

// ── GroupingConcept ─────────────────────────────────────────────────

export interface GroupItem {
  id: string;
  course: string;
  name: string;
  teacher?: string;
  active: boolean;
  createdAt: Date;
}

export class GroupingConcept {
  private groups = new Map<string, GroupItem>();

  createGroup({ id, course, name }: { id: string; course: string; name: string }) {
    if (!name || !course) {
      return { error: "INVALID_INPUT", detail: "Name and course are required" };
    }
    const group: GroupItem = { id, course, name, active: true, createdAt: new Date() };
    this.groups.set(id, group);
    return { group: id, course, name };
  }

  archiveGroup({ id }: { id: string }) {
    const group = this.groups.get(id);
    if (!group) return { error: "GROUP_NOT_FOUND", detail: `Group ${id} not found` };
    if (!group.active) {
      return { error: "ALREADY_ARCHIVED", detail: `Group ${id} is already archived` };
    }
    group.active = false;
    return { group: id };
  }

  restoreGroup({ id }: { id: string }) {
    const group = this.groups.get(id);
    if (!group) return { error: "GROUP_NOT_FOUND", detail: `Group ${id} not found` };
    if (group.active) {
      return { error: "ALREADY_ACTIVE", detail: `Group ${id} is already active` };
    }
    group.active = true;
    return { group: id };
  }

  assignTeacher({ id, teacher }: { id: string; teacher: string }) {
    const group = this.groups.get(id);
    if (!group) return { error: "GROUP_NOT_FOUND", detail: `Group ${id} not found` };
    if (!teacher) return { error: "EMPTY_TEACHER", detail: "Teacher id must not be empty" };
    group.teacher = teacher;
    return { group: id, teacher };
  }

  _getGroup({ id }: { id: string }): GroupItem[] {
    const g = this.groups.get(id);
    return g ? [g] : [];
  }

  _getGroupsByCourse({ course }: { course: string }): GroupItem[] {
    return [...this.groups.values()].filter((g) => g.course === course);
  }

  _getAll(_: Empty): GroupItem[] {
    return [...this.groups.values()];
  }
}

// ── EnrollingConcept ────────────────────────────────────────────────

export type EnrollmentStatus = "active" | "dropped";

export interface EnrollmentItem {
  id: string;
  student: string;
  course: string;
  status: EnrollmentStatus;
  enrolledAt: Date;
}

export class EnrollingConcept {
  private enrollments = new Map<string, EnrollmentItem>();

  enroll({ id, student, course }: { id: string; student: string; course: string }) {
    for (const e of this.enrollments.values()) {
      if (e.student === student && e.course === course && e.status === "active") {
        return {
          error: "ALREADY_ENROLLED",
          detail: `Student ${student} is already enrolled in course ${course}`,
        };
      }
    }
    const enrollment: EnrollmentItem = {
      id,
      student,
      course,
      status: "active",
      enrolledAt: new Date(),
    };
    this.enrollments.set(id, enrollment);
    return { enrollment: id, student, course };
  }

  drop({ id }: { id: string }) {
    const enrollment = this.enrollments.get(id);
    if (!enrollment) {
      return { error: "ENROLLMENT_NOT_FOUND", detail: `Enrollment ${id} not found` };
    }
    if (enrollment.status !== "active") {
      return { error: "NOT_ACTIVE", detail: `Enrollment ${id} is not active` };
    }
    enrollment.status = "dropped";
    return { enrollment: id, student: enrollment.student, course: enrollment.course };
  }

  _getEnrollment({ id }: { id: string }): EnrollmentItem[] {
    const e = this.enrollments.get(id);
    return e ? [e] : [];
  }

  _getStudentEnrollments({ student }: { student: string }): EnrollmentItem[] {
    return [...this.enrollments.values()].filter((e) => e.student === student);
  }

  _getCourseEnrollments({ course }: { course: string }): EnrollmentItem[] {
    return [...this.enrollments.values()].filter((e) => e.course === course);
  }

  _getActiveEnrollments(_: Empty): EnrollmentItem[] {
    return [...this.enrollments.values()].filter((e) => e.status === "active");
  }
}

// ── ObligatingConcept ───────────────────────────────────────────────

export type ObligationStatus = "pending" | "paid" | "cancelled";

export interface ObligationItem {
  id: string;
  student: string;
  course: string;
  amount: number;
  status: ObligationStatus;
  dueDate: Date;
  createdAt: Date;
}

export class ObligatingConcept {
  private obligations = new Map<string, ObligationItem>();

  createObligation({
    id,
    student,
    course,
    amount,
    dueDate,
  }: {
    id: string;
    student: string;
    course: string;
    amount: number;
    dueDate: Date;
  }) {
    if (!student || !course) {
      return { error: "INVALID_INPUT", detail: "Student and course are required" };
    }
    const obl: ObligationItem = {
      id,
      student,
      course,
      amount,
      status: "pending",
      dueDate,
      createdAt: new Date(),
    };
    this.obligations.set(id, obl);
    return { obligation: id, student, course, amount };
  }

  markPaid({ id }: { id: string }) {
    const obl = this.obligations.get(id);
    if (!obl) {
      return { error: "OBLIGATION_NOT_FOUND", detail: `Obligation ${id} not found` };
    }
    if (obl.status !== "pending") {
      return { error: "NOT_PENDING", detail: `Obligation ${id} is not pending` };
    }
    obl.status = "paid";
    return { obligation: id, student: obl.student, course: obl.course };
  }

  cancelObligation({ id }: { id: string }) {
    const obl = this.obligations.get(id);
    if (!obl) {
      return { error: "OBLIGATION_NOT_FOUND", detail: `Obligation ${id} not found` };
    }
    if (obl.status === "cancelled") {
      return { error: "ALREADY_CANCELLED", detail: `Obligation ${id} is already cancelled` };
    }
    obl.status = "cancelled";
    return { obligation: id };
  }

  _getObligation({ id }: { id: string }): ObligationItem[] {
    const o = this.obligations.get(id);
    return o ? [o] : [];
  }

  _getByStudent({ student }: { student: string }): ObligationItem[] {
    return [...this.obligations.values()].filter((o) => o.student === student);
  }

  _getByCourse({ course }: { course: string }): ObligationItem[] {
    return [...this.obligations.values()].filter((o) => o.course === course);
  }

  _getActiveObligations(_: Empty): ObligationItem[] {
    return [...this.obligations.values()].filter((o) => o.status === "pending");
  }
}

// ── AuditConcept ────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  event: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export class AuditConcept {
  readonly log: AuditEntry[] = [];

  record({ id, event, entityType, entityId, data }: AuditEntry) {
    this.log.push({ id, event, entityType, entityId, data, timestamp: new Date() });
    return { event: id };
  }

  _getLog(_: Empty): AuditEntry[] {
    return [...this.log];
  }

  _getByEntity({ entityType, entityId }: { entityType: string; entityId: string }): AuditEntry[] {
    return this.log.filter((e) => e.entityType === entityType && e.entityId === entityId);
  }
}
