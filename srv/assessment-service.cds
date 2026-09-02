using { uisp } from '../db/schema';

service AssessmentService {

  entity Groups           as projection on uisp.Groups;
  entity Students         as projection on uisp.Students;
  entity AssessmentRounds as projection on uisp.AssessmentRounds;

  // Пълни оценки (само за инструктор)
  @cds.redirection.target
  entity PeerAssessments  as projection on uisp.PeerAssessments;

  // Анонимизиран изглед за студент — без assessor
  view AnonymousAssessments as select from uisp.PeerAssessments {
    ID,
    round.ID   as roundId,
    subject.ID as subjectId,
    dim1, dim2, dim3, dim4, comment, submittedAt
  };

  // Средна оценка по студент и кръг
  view PeerAvg as select from uisp.PeerAssessments {
    key round.ID   as roundId,
    key subject.ID as studentId,
    cast((dim1 + dim2 + dim3 + dim4) as Integer) as total
  };

  // Action за отваряне на кръг (изпраща имейли)
  action openRound(roundId : String) returns String;

  // Извиква се от jobscheduler — изпраща напомняния за всички отворени кръгове
  action sendReminders() returns String;

  // CSV import: поставяне на текст с редове "name,email,group"
  action importStudents(csv : LargeString) returns String;
}
