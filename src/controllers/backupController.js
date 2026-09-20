const { allQuery, runQuery } = require('../db/sqlite');

// 1. Sao lưu toàn bộ dữ liệu hệ thống (Export Backup JSON)
async function exportBackup(req, res) {
  try {
    const users = await allQuery(`SELECT id, username, full_name, role FROM users`);
    const classes = await allQuery(`SELECT * FROM classes`);
    const groups = await allQuery(`SELECT * FROM groups`);
    const students = await allQuery(`SELECT * FROM students`);
    const eventTypes = await allQuery(`SELECT * FROM event_types`);
    const behaviorEvents = await allQuery(`SELECT * FROM behavior_events`);
    const attendance = await allQuery(`SELECT * FROM attendance`);
    const specializedLogs = await allQuery(`SELECT * FROM specialized_logs`);
    const crossEval = await allQuery(`SELECT * FROM cross_eval_assignments`);

    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      app: 'Trợ lý số dành cho Giáo viên THPT',
      data: {
        users,
        classes,
        groups,
        students,
        eventTypes,
        behaviorEvents,
        attendance,
        specializedLogs,
        crossEval
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="TroLySoGV_Backup_${new Date().toISOString().split('T')[0]}.json"`);
    return res.json(backupData);
  } catch (err) {
    console.error('Lỗi sao lưu:', err);
    return res.status(500).json({ message: 'Lỗi sao lưu dữ liệu' });
  }
}

// 2. Phục hồi dữ liệu từ file Backup JSON (Restore)
async function importRestore(req, res) {
  try {
    const { data } = req.body;
    if (!data || !data.students) {
      return res.status(400).json({ message: 'Tệp sao lưu không đúng định dạng' });
    }

    // Restore specialized logs if provided
    if (Array.isArray(data.specializedLogs)) {
      await runQuery(`DELETE FROM specialized_logs`);
      for (const log of data.specializedLogs) {
        await runQuery(
          `INSERT INTO specialized_logs (category, title, date, lesson_period, class_name, tech_used, evidence, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [log.category, log.title, log.date, log.lesson_period, log.class_name, log.tech_used, log.evidence, log.note]
        );
      }
    }

    return res.json({ message: 'Khôi phục dữ liệu thành công!' });
  } catch (err) {
    console.error('Lỗi khôi phục:', err);
    return res.status(500).json({ message: 'Lỗi khôi phục dữ liệu' });
  }
}

module.exports = {
  exportBackup,
  importRestore
};
