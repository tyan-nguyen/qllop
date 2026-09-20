const { allQuery, getQuery } = require('../db/sqlite');

async function getAutoRewards(req, res) {
  try {
    const { class_id } = req.query;

    let targetClassId = class_id;
    if (!targetClassId) {
      const defaultClass = await getQuery(`SELECT id FROM classes ORDER BY school_year DESC, id ASC LIMIT 1`);
      targetClassId = defaultClass ? defaultClass.id : 1;
    }

    // 1. All students scoring details of class
    const studentScores = await allQuery(`
      SELECT 
        s.id, s.student_code, s.full_name, g.group_name,
        100 + COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as current_score,
        COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0) as total_bonus_points,
        COUNT(CASE WHEN et.category = 'BONUS' THEN 1 END) as bonus_count
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      WHERE s.class_id = ?
      GROUP BY s.id
      ORDER BY current_score DESC
    `, [targetClassId]);

    // Top highest score
    const highestScoreStudent = studentScores[0] || null;

    // Most bonus points / Most progress
    const mostBonusStudent = [...studentScores].sort((a, b) => b.total_bonus_points - a.total_bonus_points)[0] || null;

    // Most good deeds count
    const mostGoodDeedsStudent = [...studentScores].sort((a, b) => b.bonus_count - a.bonus_count)[0] || null;

    // Group ranking (Best group)
    const groups = await allQuery(`SELECT id, group_name FROM groups WHERE class_id = ?`, [targetClassId]);
    const groupSummaries = groups.map(g => {
      const gStudents = studentScores.filter(s => s.group_name === g.group_name);
      const total = gStudents.reduce((sum, s) => sum + s.current_score, 0);
      const avg = gStudents.length > 0 ? parseFloat((total / gStudents.length).toFixed(2)) : 0;
      return { group_name: g.group_name, avg_score: avg };
    });
    groupSummaries.sort((a, b) => b.avg_score - a.avg_score);
    const bestGroup = groupSummaries[0] || null;

    return res.json({
      class_id: parseInt(targetClassId),
      individual: {
        highestScore: highestScoreStudent,
        mostBonus: mostBonusStudent,
        mostGoodDeeds: mostGoodDeedsStudent
      },
      collective: {
        bestGroup
      }
    });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách khen thưởng tự động' });
  }
}

module.exports = {
  getAutoRewards
};
