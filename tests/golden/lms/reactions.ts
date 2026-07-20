import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Golden test app — reaction reactions for the LMS application.
 *
 * Every reaction follows the `when → where → then` pattern:
 *  - `when` matches action records;
 *  - `where` reads current concept state when needed;
 *  - `then` asks actions for each matching set of values.
 *
 * Key patterns demonstrated:
 *  - Cross-concept cascading through query lines in `where`
 *  - Multi-reaction fan-out (multiple reactions watching the same action)
 *  - Cross-concept data creation (enrollment → obligation)
 *
 * Audit reactions are absent because AuditFeed reads the engine's action and
 * firing records directly.
 */

import { request, type Vars, when } from "@sync-engine/internal/reactions";
import type {
  EnrollingConcept,
  GroupingConcept,
  ObligatingConcept,
  OrganizingConcept,
  ProfilingConcept,
  TimingConcept,
} from "./concepts.ts";

export function makeLMSReactions(
  Profiles: ProfilingConcept,
  Courses: OrganizingConcept,
  Groups: GroupingConcept,
  Enrollments: EnrollingConcept,
  Obligations: ObligatingConcept,
  Timing: TimingConcept,
) {
  // ── Cascading: profile deactivate ────────────────────────

  const OnProfileDeactivated_DropEnrollments = ({ profileId, enrollmentId }: Vars) =>
    when(Profiles.deactivate, { id: profileId }, { profile: profileId })
      .where(
        lineOf({ query: Enrollments._getStudentEnrollments }, { student: profileId }).is({
          id: enrollmentId,
        }),
      )
      .then(request(Enrollments.drop, { id: enrollmentId }));

  const OnProfileDeactivated_CancelObligations = ({ profileId, obligationId }: Vars) =>
    when(Profiles.deactivate, { id: profileId }, { profile: profileId })
      .where(
        lineOf({ query: Obligations._getByStudent }, { student: profileId }).is({
          id: obligationId,
        }),
      )
      .then(request(Obligations.cancelObligation, { id: obligationId }));

  // ── Cascading: course archive ────────────────────────────
  // Multiple independent reactions watch Courses.archive and each
  // handles a different downstream concern.

  const OnCourseArchived_DropEnrollments = ({ courseId, enrollmentId }: Vars) =>
    when(Courses.archive, { id: courseId }, { course: courseId })
      .where(
        lineOf({ query: Enrollments._getCourseEnrollments }, { course: courseId }).is({
          id: enrollmentId,
        }),
      )
      .then(request(Enrollments.drop, { id: enrollmentId }));

  const OnCourseArchived_ArchiveGroups = ({ courseId, groupId }: Vars) =>
    when(Courses.archive, { id: courseId }, { course: courseId })
      .where(lineOf({ query: Groups._getGroupsByCourse }, { course: courseId }).is({ id: groupId }))
      .then(request(Groups.archiveGroup, { id: groupId }));

  const OnCourseArchived_CancelObligations = ({ courseId, obligationId }: Vars) =>
    when(Courses.archive, { id: courseId }, { course: courseId })
      .where(
        lineOf({ query: Obligations._getByCourse }, { course: courseId }).is({ id: obligationId }),
      )
      .then(request(Obligations.cancelObligation, { id: obligationId }));

  // ── Enrollment → obligation creation ────────────────────
  // When a student enrolls, a default obligation is created.

  const OnEnrollmentCreated_InitObligation = ({ enrollmentId, student, course, dueDate }: Vars) =>
    when(Enrollments.enroll, {}, { enrollment: enrollmentId, student, course })
      .where(lineOf({ query: Timing._now }, {}).is({ now: dueDate }))
      .then(
        request(Obligations.createObligation, {
          id: enrollmentId,
          student,
          course,
          amount: 0,
          dueDate,
        }),
      );

  return {
    // Profile cascade
    OnProfileDeactivated_DropEnrollments,
    OnProfileDeactivated_CancelObligations,
    // Course cascade
    OnCourseArchived_DropEnrollments,
    OnCourseArchived_ArchiveGroups,
    OnCourseArchived_CancelObligations,
    // Enrollment → obligation
    OnEnrollmentCreated_InitObligation,
  } as const;
}
