# HIVE notification policy (draft for Kody and Stacie, 2026-09-29)

**Status: drafted at Kody's instruction ("Build a notification policy for
us") and approved by him on 2026-09-29 ("approved"); Stacie may adjust
the wording before the notification work starts.
Nothing in the app sends a notification today; the brief excluded them
from the first milestones on purpose. This policy is the rule the
notification work (the second step of the live-information direction)
is built to, and every rule here is testable.**

## 1. What a notification is for

A notification tells a person that something in HIVE needs them or
changed for them, so they open the app. It never carries the thing
itself. HIVE's calm working view stays inside the app; the notification
is a knock on the door, not the conversation.

## 2. Two channels, one rule

- **Push** (the phone's notification tray) for people who allow it on
  their device and in the app.
- **Email** to the sign-in address, only where push is off or the event
  is one a person should find in their inbox later (a deletion
  completed, a review window opened for a store reviewer).

The rule for both: **a notification names the kind of event and nothing
else.** No client name, no entity name, no document name, no question
text, no amount, no person's name. Apple and Google carry push text
through their own servers, and email travels through Resend; none of
them should ever hold client content, and with this rule they never do.

## 3. What may trigger one

| Event                                         | Who is told                              | The text (exact, no fill-ins)                            |
| --------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| A request or question is opened for a client  | the client users of the scope            | "Honeybee needs something from you in HIVE."             |
| A document is accepted or not accepted        | the client user who added it             | "There is an update on a document you added."            |
| A case's status changes                       | the client users of the scope            | "The status of your books changed."                      |
| A client submits an answer or adds a document | the staff of the scope                   | "A client responded in HIVE."                            |
| A package is ready for review or approval     | the staff who hold that role             | "Something is ready for your review."                    |
| An account deletion is completed              | the person, by email only                | the deletion confirmation already required by the policy |
| The service is paused or resumed              | nobody by push; the app shows it on open |

Nothing else. In particular: no reminders, no marketing, no "we miss you",
no notification about another person's activity beyond the rows above.

## 4. How often

- At most one push per person per event kind per hour: later events of
  the same kind within the hour fold into the one already sent.
- At most six pushes per person per day.
- Quiet hours from 9 pm to 7 am in the person's device time zone: events
  in that span are held and sent as one at 7 am.
- A person who has not opened the app in ninety days receives no push;
  the next open turns it back on.

## 5. Choice

- Push is off until the person allows it on the device and turns it on in
  the app's Account screen, per event kind.
- Every kind can be turned off separately; turning all off is one switch.
- Email notifications can be turned off except the deletion confirmation,
  which the law and the deletion page promise.
- Signing out, or deleting the account, removes the device's push
  registration at once.

## 6. What HIVE keeps to do this

- A push registration per device: the platform's push token, the person,
  the device's platform, the time it was registered. Nothing about the
  device beyond that. Deleted on sign-out, on account deletion, and when
  the platform reports the token dead.
- A log per notification: which kind, to whom, when, over which channel,
  and whether the platform accepted it. Never the text, which is fixed
  anyway. Kept ninety days.
- Both under the same row-level security as everything else: a person
  reads only their own.

## 7. What changes elsewhere before the first notification ships

- The privacy policy: section 3 ("Nothing else") gains the push
  registration; section 5 says Apple and Google carry the notification
  text, which holds no content; the effective date changes.
- The store answers: both stores' data forms gain "device identifiers
  for notifications", used for app functionality only, not linked to
  advertising.
- The security review: the sending job holds the push credentials on the
  server only; the app holds none.
- The kill switch: a paused service sends nothing.

## 8. What this policy excludes

Text messages. Third-party notification services beyond the platforms'
own. Tracking of opens or taps. Any notification whose text is composed
from data rather than chosen from the table above.

---

_Approval: Kody (product, security) and Stacie (client experience and
wording). Once approved, the table in section 3 is the test fixture for
the notification work, word for word._
