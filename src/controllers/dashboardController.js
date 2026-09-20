const { getQuery, allQuery } = require('../db/sqlite');

async function getDashboardStats(req, res) {
  try {
    const { class_id } = req.query;

    let targetClassId = class_id;
    if (!targetClassId) {
      const defaultClass = await getQuery(`SELECT id FROM classes ORDER BY school_year DESC, id ASC LIMIT 1`);
      targetClassId = defaultClass ? defaultClass.id : 1;
    }

    // 1. Total students for class
    const studentCountRow = await getQuery(`SELECT COUNT(*) as count FROM students WHERE class_id = ?`, [targetClassId]);
    const totalStudents = studentCountRow ? studentCountRow.count : 0;

    // 2. Class details
    const currentClass = await getQuery(`
      SELECT c.*, t.full_name as teacher_name
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.id
      WHERE c.id = ?
    `, [targetClassId]);

    // 3. Attendance stats today
    const today = new Date().toISOString().split('T')[0];
    const todayAttendance = await allQuery(`
      SELECT a.status, COUNT(a.id) as count 
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE s.class_id = ? AND a.date = ? 
      GROUP BY a.status
    `, [targetClassId, today]);
    
    // 4. Behavior stats for this class
    const behaviorStats = await allQuery(`
      SELECT et.category, COUNT(be.id) as total_events
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      JOIN students s ON be.student_id = s.id
      WHERE s.class_id = ?
      GROUP BY et.category
    `, [targetClassId]);

    // 5. Specialized stats (GV activities)
    const teacherId = currentClass?.teacher_id;
    let specializedStats = [];
    if (teacherId) {
      specializedStats = await allQuery(`
        SELECT category, COUNT(*) as count
        FROM specialized_logs
        WHERE teacher_id = ?
        GROUP BY category
      `, [teacherId]);
    } else {
      specializedStats = await allQuery(`
        SELECT category, COUNT(*) as count
        FROM specialized_logs
        GROUP BY category
      `);
    }

    // 6. Top students & Attention required students
    const studentsScored = await allQuery(`
      SELECT 
        s.id, s.student_code, s.full_name, g.group_name,
        100 + COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as current_score
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      WHERE s.class_id = ?
      GROUP BY s.id
      ORDER BY current_score DESC
    `, [targetClassId]);

    const topStudents = studentsScored.slice(0, 5);
    const needAttention = studentsScored.filter(s => s.current_score < 80).slice(0, 5);

    return res.json({
      targetClassId: parseInt(targetClassId),
      currentClass,
      totalStudents,
      todayAttendance,
      behaviorStats,
      specializedStats,
      topStudents,
      needAttention
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ message: 'Lỗi lấy thống kê dashboard' });
  }
}

module.exports = {
  getDashboardStats
};
