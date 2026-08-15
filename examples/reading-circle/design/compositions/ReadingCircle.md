# Reading Circle

A reading circle brings members together around one current reading and keeps
their discussion attached to that circle's particular selection.

A host [creates a circle](reaction:ReadingCircle.CircleMembership.CreateCircle)
as its first member, and other people may
[join it](reaction:ReadingCircle.CircleMembership.JoinCircle).

[Choosing a reading](reaction:ReadingCircle.ReadingDiscussion.ChooseReading) for
a circle [opens a discussion for that selection](reaction:ReadingCircle.ReadingDiscussion.SelectedReadingOpensDiscussion).
A person [may respond when membership holds](view:ReadingCircle.ReadingDiscussion.MemberMayRespond),
and the [accepted response endpoint](reaction:ReadingCircle.ReadingDiscussion.AddResponse)
adds that response to the current reading's discussion. The complementary
[nonmembership relation](view:ReadingCircle.ReadingDiscussion.NonmemberMayNotRespond)
drives the [rejection endpoint](reaction:ReadingCircle.ReadingDiscussion.RejectNonmemberResponse),
which returns `NOT_A_MEMBER`.

[Opening a circle](reaction:ReadingCircle.CirclePages.GetCirclePage) uses the
[circle page](former:ReadingCircle.CirclePages.CirclePage) to present its name,
host, members, current reading, and the responses to that reading together.
