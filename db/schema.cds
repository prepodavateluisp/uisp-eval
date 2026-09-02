namespace uisp;

using { cuid, managed } from '@sap/cds/common';

entity Groups : cuid {
  name    : String(100) not null;
}

entity Students : cuid {
  name  : String(200) not null;
  email : String(200) not null;
  group : Association to Groups;
}

entity AssessmentRounds : cuid {
  label               : String(100) not null;
  sessionAfter        : Integer;
  status              : String(10) default 'draft'; // draft | open | closed
  deadline            : Timestamp;
  reminderHoursBefore : Integer default 24;
}

entity PeerAssessments : cuid {
  round       : Association to AssessmentRounds not null;
  assessor    : Association to Students not null;
  subject     : Association to Students not null;
  dim1        : Integer not null; // Подготвеност
  dim2        : Integer not null; // Принос
  dim3        : Integer not null; // Надеждност
  dim4        : Integer not null; // Отношение
  comment     : String(1000);
  submittedAt : Timestamp;
}
