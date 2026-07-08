/**
 * Golden test app — synchronization rules for the LMS application.
 *
 * Every sync follows the `when → where → then` pattern:
 *  - when   — action patterns matched against the journal
 *  - where  — optional pure transform over matched frames
 *  - then   — actions to dispatch per surviving frame
 *
 * Key patterns demonstrated:
 *  - Success/error discrimination via output patterns in `when`
 *  - Cross-concept cascading via `frames.query()` in `where`
 *  - Branch handling via `act().branch(on(), onError())`
 *  - Sequential actions via `seq()`
 *  - Multi-sync fan-out (multiple syncs watching the same action)
 *  - Cross-concept data creation (enrollment → obligation)
 */

import { act, on, onError, seq, type Vars, when } from "@sync-engine/engine";
import type {
  AuditConcept,
  EnrollingConcept,
  GroupingConcept,
  ObligatingConcept,
  OrganizingConcept,
  ProfilingConcept,
} from "./concepts.ts";

export function makeLMSSyncs(
  Profiles: ProfilingConcept,
  Courses: OrganizingConcept,
  Groups: GroupingConcept,
  Enrollments: EnrollingConcept,
  Obligations: ObligatingConcept,
  Audit: AuditConcept,
) {
  // ── Profile audit syncs ─────────────────────────────────

  const AuditProfileCreate = ({ profileId }: Vars) =>
    when(Profiles.createProfile, { id: profileId }, { profile: profileId }).then(
      act(Audit.record, {
        id: profileId,
        event: "PROFILE_CREATED",
        entityType: "profile",
        entityId: profileId,
        data: { profileId },
      }),
    );

  const AuditProfileUpdate = ({ profileId }: Vars) =>
    when(Profiles.updateName, { id: profileId }, { profile: profileId }).then(
      act(Audit.record, {
        id: profileId,
        event: "PROFILE_UPDATED",
        entityType: "profile",
        entityId: profileId,
        data: { profileId },
      }),
    );

  const AuditProfileDeactivate = ({ profileId }: Vars) =>
    when(Profiles.deactivate, { id: profileId }, { profile: profileId }).then(
      act(Audit.record, {
        id: profileId,
        event: "PROFILE_DEACTIVATED",
        entityType: "profile",
        entityId: profileId,
        data: { profileId },
      }),
    );

  // ── Cascading: profile deactivate ────────────────────────

  const OnProfileDeactivated_DropEnrollments = ({ profileId, enrollmentId, error }: Vars) =>
    when(Profiles.deactivate, { id: profileId }, { profile: profileId })
      .where((frames) =>
        frames.query(
          Enrollments._getStudentEnrollments,
          { student: profileId },
          { id: enrollmentId },
        ),
      )
      .then(
        act(Enrollments.drop, { id: enrollmentId }).branch(
          on(
            act(Audit.record, {
              id: enrollmentId,
              event: "ENROLLMENT_CASCADE_DROPPED",
              entityType: "enrollment",
              entityId: enrollmentId,
              data: { reason: "profile_deactivated", profileId },
            }),
          ),
          onError(
            { error: [error] },
            act(Audit.record, {
              id: enrollmentId,
              event: "ENROLLMENT_CASCADE_DROP_FAILED",
              entityType: "enrollment",
              entityId: enrollmentId,
              data: { reason: "profile_deactivated", profileId, error },
            }),
          ),
        ),
      );

  const OnProfileDeactivated_CancelObligations = ({ profileId, obligationId, error }: Vars) =>
    when(Profiles.deactivate, { id: profileId }, { profile: profileId })
      .where((frames) =>
        frames.query(Obligations._getByStudent, { student: profileId }, { id: obligationId }),
      )
      .then(
        act(Obligations.cancelObligation, { id: obligationId }).branch(
          on(
            act(Audit.record, {
              id: obligationId,
              event: "OBLIGATION_CASCADE_CANCELLED",
              entityType: "obligation",
              entityId: obligationId,
              data: { reason: "profile_deactivated", profileId },
            }),
          ),
          onError(
            { error: [error] },
            act(Audit.record, {
              id: obligationId,
              event: "OBLIGATION_CASCADE_CANCEL_FAILED",
              entityType: "obligation",
              entityId: obligationId,
              data: { reason: "profile_deactivated", profileId, error },
            }),
          ),
        ),
      );

  // ── Course audit syncs ──────────────────────────────────

  const AuditCourseCreate = ({ courseId }: Vars) =>
    when(Courses.createCourse, { id: courseId }, { course: courseId }).then(
      act(Audit.record, {
        id: courseId,
        event: "COURSE_CREATED",
        entityType: "course",
        entityId: courseId,
        data: { courseId },
      }),
    );

  const AuditCourseUpdate = ({ courseId }: Vars) =>
    when(Courses.updateName, { id: courseId }, { course: courseId }).then(
      act(Audit.record, {
        id: courseId,
        event: "COURSE_UPDATED",
        entityType: "course",
        entityId: courseId,
        data: { courseId },
      }),
    );

  const AuditCourseArchive = ({ courseId }: Vars) =>
    when(Courses.archive, { id: courseId }, { course: courseId }).then(
      act(Audit.record, {
        id: courseId,
        event: "COURSE_ARCHIVED",
        entityType: "course",
        entityId: courseId,
        data: { courseId },
      }),
    );

  // ── Cascading: course archive ────────────────────────────
  // Multiple independent syncs watch Courses.archive and each
  // handles a different downstream concern.

  const OnCourseArchived_DropEnrollments = ({ courseId, enrollmentId }: Vars) =>
    when(Courses.archive, { id: courseId }, { course: courseId })
      .where((frames) =>
        frames.query(Enrollments._getCourseEnrollments, { course: courseId }, { id: enrollmentId }),
      )
      .then(
        seq(
          act(Enrollments.drop, { id: enrollmentId }),
          act(Audit.record, {
            id: enrollmentId,
            event: "ENROLLMENT_CASCADE_DROPPED",
            entityType: "enrollment",
            entityId: enrollmentId,
            data: { reason: "course_archived", courseId },
          }),
        ),
      );

  const OnCourseArchived_ArchiveGroups = ({ courseId, groupId, error }: Vars) =>
    when(Courses.archive, { id: courseId }, { course: courseId })
      .where((frames) =>
        frames.query(Groups._getGroupsByCourse, { course: courseId }, { id: groupId }),
      )
      .then(
        act(Groups.archiveGroup, { id: groupId }).branch(
          on(
            act(Audit.record, {
              id: groupId,
              event: "GROUP_CASCADE_ARCHIVED",
              entityType: "group",
              entityId: groupId,
              data: { reason: "course_archived", courseId },
            }),
          ),
          onError(
            { error: [error] },
            act(Audit.record, {
              id: groupId,
              event: "GROUP_CASCADE_ARCHIVE_FAILED",
              entityType: "group",
              entityId: groupId,
              data: { reason: "course_archived", courseId, error },
            }),
          ),
        ),
      );

  const OnCourseArchived_CancelObligations = ({ courseId, obligationId, error }: Vars) =>
    when(Courses.archive, { id: courseId }, { course: courseId })
      .where((frames) =>
        frames.query(Obligations._getByCourse, { course: courseId }, { id: obligationId }),
      )
      .then(
        act(Obligations.cancelObligation, { id: obligationId }).branch(
          on(
            act(Audit.record, {
              id: obligationId,
              event: "OBLIGATION_CASCADE_CANCELLED",
              entityType: "obligation",
              entityId: obligationId,
              data: { reason: "course_archived", courseId },
            }),
          ),
          onError(
            { error: [error] },
            act(Audit.record, {
              id: obligationId,
              event: "OBLIGATION_CASCADE_CANCEL_FAILED",
              entityType: "obligation",
              entityId: obligationId,
              data: { reason: "course_archived", courseId, error },
            }),
          ),
        ),
      );

  // ── Enrollment → obligation creation ────────────────────
  // When a student enrolls, a default obligation is created.

  const OnEnrollmentCreated_InitObligation = ({ enrollmentId, student, course }: Vars) =>
    when(Enrollments.enroll, {}, { enrollment: enrollmentId, student, course }).then(
      act(Obligations.createObligation, {
        id: enrollmentId,
        student,
        course,
        amount: 0,
        dueDate: new Date(),
      }),
    );

  // ── Enrollment audit syncs ──────────────────────────────

  const AuditEnrollmentCreate = ({ enrollmentId }: Vars) =>
    when(Enrollments.enroll, { id: enrollmentId }, { enrollment: enrollmentId }).then(
      act(Audit.record, {
        id: enrollmentId,
        event: "ENROLLMENT_CREATED",
        entityType: "enrollment",
        entityId: enrollmentId,
        data: { enrollmentId },
      }),
    );

  const AuditEnrollmentError = ({ enrollmentId, error }: Vars) =>
    when(Enrollments.enroll, { id: enrollmentId }, { error }).then(
      act(Audit.record, {
        id: enrollmentId,
        event: "ENROLLMENT_FAILED",
        entityType: "enrollment",
        entityId: enrollmentId,
        data: { enrollmentId, error },
      }),
    );

  const AuditEnrollmentDrop = ({ enrollmentId }: Vars) =>
    when(Enrollments.drop, { id: enrollmentId }, { enrollment: enrollmentId }).then(
      act(Audit.record, {
        id: enrollmentId,
        event: "ENROLLMENT_DROPPED",
        entityType: "enrollment",
        entityId: enrollmentId,
        data: { enrollmentId },
      }),
    );

  // ── Group audit syncs ───────────────────────────────────

  const AuditGroupCreate = ({ groupId }: Vars) =>
    when(Groups.createGroup, { id: groupId }, { group: groupId }).then(
      act(Audit.record, {
        id: groupId,
        event: "GROUP_CREATED",
        entityType: "group",
        entityId: groupId,
        data: { groupId },
      }),
    );

  const AuditGroupArchive = ({ groupId }: Vars) =>
    when(Groups.archiveGroup, { id: groupId }, { group: groupId }).then(
      act(Audit.record, {
        id: groupId,
        event: "GROUP_ARCHIVED",
        entityType: "group",
        entityId: groupId,
        data: { groupId },
      }),
    );

  const AuditGroupRestore = ({ groupId }: Vars) =>
    when(Groups.restoreGroup, { id: groupId }, { group: groupId }).then(
      act(Audit.record, {
        id: groupId,
        event: "GROUP_RESTORED",
        entityType: "group",
        entityId: groupId,
        data: { groupId },
      }),
    );

  const AuditGroupAssignTeacher = ({ groupId }: Vars) =>
    when(Groups.assignTeacher, { id: groupId }, { group: groupId }).then(
      act(Audit.record, {
        id: groupId,
        event: "GROUP_TEACHER_ASSIGNED",
        entityType: "group",
        entityId: groupId,
        data: { groupId },
      }),
    );

  // ── Obligation audit syncs ──────────────────────────────

  const AuditObligationCreate = ({ obligationId }: Vars) =>
    when(Obligations.createObligation, { id: obligationId }, { obligation: obligationId }).then(
      act(Audit.record, {
        id: obligationId,
        event: "OBLIGATION_CREATED",
        entityType: "obligation",
        entityId: obligationId,
        data: { obligationId },
      }),
    );

  const AuditObligationPaid = ({ obligationId }: Vars) =>
    when(Obligations.markPaid, { id: obligationId }, { obligation: obligationId }).then(
      act(Audit.record, {
        id: obligationId,
        event: "OBLIGATION_PAID",
        entityType: "obligation",
        entityId: obligationId,
        data: { obligationId },
      }),
    );

  const AuditObligationCancel = ({ obligationId }: Vars) =>
    when(Obligations.cancelObligation, { id: obligationId }, { obligation: obligationId }).then(
      act(Audit.record, {
        id: obligationId,
        event: "OBLIGATION_CANCELLED",
        entityType: "obligation",
        entityId: obligationId,
        data: { obligationId },
      }),
    );

  return {
    // Profile
    AuditProfileCreate,
    AuditProfileUpdate,
    AuditProfileDeactivate,
    // Profile cascade
    OnProfileDeactivated_DropEnrollments,
    OnProfileDeactivated_CancelObligations,
    // Course
    AuditCourseCreate,
    AuditCourseUpdate,
    AuditCourseArchive,
    // Course cascade
    OnCourseArchived_DropEnrollments,
    OnCourseArchived_ArchiveGroups,
    OnCourseArchived_CancelObligations,
    // Enrollment → obligation
    OnEnrollmentCreated_InitObligation,
    // Enrollment
    AuditEnrollmentCreate,
    AuditEnrollmentError,
    AuditEnrollmentDrop,
    // Group
    AuditGroupCreate,
    AuditGroupArchive,
    AuditGroupRestore,
    AuditGroupAssignTeacher,
    // Obligation
    AuditObligationCreate,
    AuditObligationPaid,
    AuditObligationCancel,
  } as const;
}
