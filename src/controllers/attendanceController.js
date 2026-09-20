const { runQuery, getQuery, allQuery } = require('../db/sqlite');

// Lấy danh sách điểm danh ngày theo lớp
async function getAttendance(req, res) {
  try {
    const { class_id } = req.query;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    let targetClassId = class_id;
    if (!targetClassId) {
      const defaultClass = await getQuery(`SELECT id FROM classes ORDER BY school_year DESC, id ASC LIMIT 1`);
      targetClassId = defaultClass ? defaultClass.id : 1;
    }

    const records = await allQuery(`
      SELECT s.id as student_id, s.student_code, s.full_name, s.group_id, g.group_name, a.status, a.note
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
      WHERE s.class_id = ?
      ORDER BY s.student_code ASC
    `, [date, targetClassId]);

    const result = records.map(r => ({
      student_id: r.student_id,
      student_code: r.student_code,
      full_name: r.full_name,
      group_id: r.group_id,
      group_name: r.group_name,
      status: r.status || 'PRESENT',
      note: r.note || '',
      date: date
    }));

    return res.json({ date, class_id: parseInt(targetClassId), attendance: result });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy thông tin điểm danh' });
  }
}

// Lưu điểm danh hàng ngày
async function saveAttendance(req, res) {
  try {
    const { date, items, class_id } = req.body;
    const teacherId = req.user.id;

    if (!date || !Array.isArray(items)) {
      return res.status(400).json({ message: 'Dữ liệu điểm danh không hợp lệ' });
    }

    for (const item of items) {
      await runQuery(`
        INSERT INTO attendance (student_id, date, status, note, created_by_teacher_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(student_id, date) DO UPDATE SET
          status = excluded.status,
          note = excluded.note,
          created_by_teacher_id = excluded.created_by_teacher_id
      `, [item.student_id, date, item.status, item.note || '', teacherId]);
    }

    return res.json({ message: 'Lưu điểm danh thành công!' });
  } catch (err) {
    console.error('Error save attendance:', err);
    return res.status(500).json({ message: 'Lỗi khi lưu thông tin điểm danh' });
  }
}

module.exports = {
  getAttendance,
  saveAttendance
};
