const cds = require('@sap/cds');
const { sendEmail } = require('./email');

module.exports = cds.service.impl(async function (srv) {

  const { PeerAssessments, Students, AssessmentRounds } = this.entities;

  async function getGroupId(studentId) {
    const student = await SELECT.one.from(Students).where({ ID: studentId });
    return student?.group_ID;
  }

  // --- Валидации при CREATE ---
  srv.before('CREATE', PeerAssessments, async (req) => {
    const { assessor_ID, subject_ID, round_ID } = req.data;

    if (assessor_ID === subject_ID) {
      return req.error(400, 'Не можеш да оцениш себе си.');
    }

    const [assessorGroup, subjectGroup] = await Promise.all([
      getGroupId(assessor_ID),
      getGroupId(subject_ID),
    ]);
    if (!assessorGroup || assessorGroup !== subjectGroup) {
      return req.error(400, 'Можеш да оцениш само членове на твоята група.');
    }

    const round = await SELECT.one.from(AssessmentRounds).where({ ID: round_ID });
    if (!round) return req.error(404, 'Кръгът не съществува.');
    if (round.status !== 'open') {
      return req.error(400, 'Кръгът не е отворен за оценяване.');
    }

    req.data.submittedAt = new Date().toISOString();
  });

  // --- Валидации при UPDATE ---
  srv.before('UPDATE', PeerAssessments, async (req) => {
    const existing = await SELECT.one.from(PeerAssessments).where({ ID: req.data.ID });
    if (!existing) return req.error(404, 'Оценката не съществува.');

    const round = await SELECT.one.from(AssessmentRounds).where({ ID: existing.round_ID });
    if (!round) return req.error(404, 'Кръгът не съществува.');

    if (round.deadline && new Date() > new Date(round.deadline)) {
      return req.error(400, 'Крайният срок за редакция е изтекъл.');
    }
    if (round.status !== 'open') {
      return req.error(400, 'Кръгът е затворен.');
    }
  });

  // --- Валидации при DELETE ---
  srv.before('DELETE', PeerAssessments, async (req) => {
    const existing = await SELECT.one.from(PeerAssessments).where({ ID: req.params[0].ID });
    if (!existing) return;

    const round = await SELECT.one.from(AssessmentRounds).where({ ID: existing.round_ID });
    if (round?.deadline && new Date() > new Date(round.deadline)) {
      return req.error(400, 'Крайният срок е изтекъл — оценката не може да се изтрие.');
    }
  });

  // --- Action: отваряне на кръг + имейли ---
  srv.on('openRound', async (req) => {
    const { roundId } = req.data;

    const round = await SELECT.one.from(AssessmentRounds).where({ ID: roundId });
    if (!round) return req.error(404, 'Кръгът не съществува.');
    if (round.status === 'open') return req.error(400, 'Кръгът вече е отворен.');
    if (round.status === 'closed') return req.error(400, 'Затворен кръг не може да се отвори отново.');

    await UPDATE(AssessmentRounds).set({ status: 'open' }).where({ ID: roundId });

    const students = await SELECT.from(Students);
    const deadline = round.deadline
      ? new Date(round.deadline).toLocaleString('bg-BG')
      : 'без краен срок';

    await Promise.all(students.map(s =>
      sendEmail({
        to: s.email,
        subject: `UISP 2026 — ${round.label}: партньорска оценка е отворена`,
        body: `Здравей ${s.name},\n\nОткрит е нов кръг за партньорска оценка: ${round.label}.\nКраен срок: ${deadline}.\n\nМоля попълни оценките си в приложението.\n\nЕкипът на UISP 2026`,
      })
    ));

    return `Кръгът е отворен. Изпратени ${students.length} имейла.`;
  });

  // --- Action: напомняния (извиква се от jobscheduler) ---
  srv.on('sendReminders', async () => {
    const now = new Date();

    const rounds = await SELECT.from(AssessmentRounds).where({ status: 'open' });
    const activeRounds = rounds.filter(r => r.deadline && new Date(r.deadline) > now);

    let totalSent = 0;

    for (const round of activeRounds) {
      const deadline = new Date(round.deadline);
      const hoursLeft = (deadline - now) / 36e5;

      // Изпраща само когато остават reminderHoursBefore часа (±1 час толеранс)
      if (hoursLeft > round.reminderHoursBefore + 1 || hoursLeft < round.reminderHoursBefore - 1) {
        continue;
      }

      const students = await SELECT.from(Students);

      const needReminder = [];
      for (const student of students) {
        const groupmates = students.filter(s => s.group_ID === student.group_ID && s.ID !== student.ID);
        if (groupmates.length === 0) continue;

        const submitted = await SELECT.from(PeerAssessments).where({
          assessor_ID: student.ID,
          round_ID: round.ID,
        });

        if (submitted.length < groupmates.length) {
          needReminder.push(student);
        }
      }

      const deadlineStr = deadline.toLocaleString('bg-BG');
      await Promise.all(needReminder.map(s =>
        sendEmail({
          to: s.email,
          subject: `UISP 2026 — напомняне: ${round.label} приключва на ${deadlineStr}`,
          body: `Здравей ${s.name},\n\nНапомняме, че кръгът "${round.label}" за партньорска оценка приключва на ${deadlineStr}.\n\nВсе още не си попълнил оценките за всички съотборници. Моля направи го преди крайния срок.\n\nЕкипът на UISP 2026`,
        })
      ));

      totalSent += needReminder.length;
    }

    return `Изпратени ${totalSent} напомняния.`;
  });

  // --- Action: CSV import на студенти ---
  srv.on('importStudents', async (req) => {
    const { csv } = req.data;
    if (!csv?.trim()) return req.error(400, 'Празен вход.');

    const lines = csv.trim().split('\n').map(l => l.trim()).filter(Boolean);

    // Пропуска header ред ако първият ред съдържа "name" или "email"
    const start = lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('email') ? 1 : 0;

    const results = { created: 0, updated: 0, errors: [] };

    for (let i = start; i < lines.length; i++) {
      const parts = lines[i].split(',').map(p => p.trim());
      if (parts.length < 3) {
        results.errors.push(`Ред ${i + 1}: очаквани 3 колони (name, email, group), получени ${parts.length}.`);
        continue;
      }

      const [name, email, groupName] = parts;

      if (!email.includes('@')) {
        results.errors.push(`Ред ${i + 1}: невалиден имейл "${email}".`);
        continue;
      }

      // Upsert група по име
      let group = await SELECT.one.from('uisp.Groups').where({ name: groupName });
      if (!group) {
        const groupId = cds.utils.uuid();
        await INSERT.into('uisp.Groups').entries({ ID: groupId, name: groupName });
        group = { ID: groupId };
      }

      // Upsert студент по имейл
      const existing = await SELECT.one.from('uisp.Students').where({ email });
      if (existing) {
        await UPDATE('uisp.Students').set({ name, group_ID: group.ID }).where({ email });
        results.updated++;
      } else {
        await INSERT.into('uisp.Students').entries({
          ID: cds.utils.uuid(),
          name,
          email,
          group_ID: group.ID,
        });
        results.created++;
      }
    }

    const summary = `Създадени: ${results.created}, обновени: ${results.updated}` +
      (results.errors.length ? `. Грешки: ${results.errors.join(' | ')}` : '.');
    return summary;
  });
});
