const { allQuery, getQuery, runQuery } = require('../db/sqlite');

// Module 8: Cấp danh hiệu tự động cho Học sinh
async function getStudentBadges(req, res) {
  try {
    const { student_id } = req.query;

    const student = await getQuery(`
      SELECT 
        s.id, s.full_name, s.student_code, s.base_score,
        COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0) as bonus_points,
        COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as penalty_points
      FROM students s
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      WHERE s.id = ?
      GROUP BY s.id
    `, [student_id]);

    if (!student) {
      return res.status(404).json({ message: 'Không tìm thấy học sinh' });
    }

    const currentScore = student.base_score + student.bonus_points + student.penalty_points;

    // Check attendance records for Chuyên cần badge
    const unexcusedCount = await getQuery(`SELECT COUNT(*) as count FROM attendance WHERE student_id = ? AND status = 'UNEXCUSED'`, [student_id]);
    const lateCount = await getQuery(`SELECT COUNT(*) as count FROM attendance WHERE student_id = ? AND status = 'LATE'`, [student_id]);

    // Check behavior events for specific badges
    const helpFriendsCount = await getQuery(`
      SELECT COUNT(*) as count FROM behavior_events be 
      JOIN event_types et ON be.event_type_id = et.id 
      WHERE be.student_id = ? AND et.name = 'Giúp bạn'
    `, [student_id]);

    const movementCount = await getQuery(`
      SELECT COUNT(*) as count FROM behavior_events be 
      JOIN event_types et ON be.event_type_id = et.id 
      WHERE be.student_id = ? AND et.name LIKE '%phong trào%'
    `, [student_id]);

    const badges = [
      {
        id: 'guong_mau',
        title: 'Gương Mẫu',
        emoji: '👑',
        icon: 'Crown',
        desc: 'Điểm rèn luyện nề nếp từ 95 điểm trở lên',
        active: currentScore >= 95
      },
      {
        id: 'chuyen_can',
        title: 'Chuyên Cần',
        emoji: '⏰',
        icon: 'Clock',
        desc: 'Đi học đúng giờ, 0 lần vắng không phép & 0 đi trễ',
        active: (unexcusedCount.count === 0 && lateCount.count === 0)
      },
      {
        id: 'dong_doi_tot',
        title: 'Đồng Đội Tốt',
        emoji: '🤝',
        icon: 'Heart',
        desc: 'Sẵn sàng giúp đỡ bạn bè trong học tập và nề nếp',
        active: helpFriendsCount.count > 0
      },
      {
        id: 'phong_trao',
        title: 'Tích Cực Phong Trào',
        emoji: '⭐',
        icon: 'Star',
        desc: 'Hăng hái tham gia các hoạt động tập thể của lớp',
        active: movementCount.count > 0
      },
      {
        id: 'tien_bo',
        title: 'Tiến Bộ Xuất Sắc',
        emoji: '🚀',
        icon: 'TrendingUp',
        desc: 'Tích lũy điểm cộng thi đua cao trong tuần',
        active: student.bonus_points > 0
      },
      {
        id: 'cham_hoc',
        title: 'Chăm Học',
        emoji: '📚',
        icon: 'BookOpen',
        desc: 'Duy trì chuẩn bị bài đầy đủ, đạt thành tích cao',
        active: student.penalty_points === 0
      }
    ];

    return res.json({ student_id: student.id, currentScore, badges });
  } catch (err) {
    console.error('Error fetching badges:', err);
    return res.status(500).json({ message: 'Lỗi lấy danh hiệu học sinh' });
  }
}

// Biểu đồ tiến bộ cá nhân & Mục tiêu tự điều chỉnh
async function getStudentProgressHistory(req, res) {
  try {
    const { student_id } = req.query;
    const stId = student_id || 1;

    // Daily score trajectory (simulation of score evolution over recent 7 days)
    const events = await allQuery(`
      SELECT be.event_date, be.points_applied
      FROM behavior_events be
      WHERE be.student_id = ?
      ORDER BY be.event_date ASC
    `, [stId]);

    const historyMap = {};
    let runningScore = 100;

    events.forEach(e => {
      runningScore += e.points_applied;
      historyMap[e.event_date] = runningScore;
    });

    const dates = ['2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
    let scoreTracker = 100;
    const chartData = dates.map(d => {
      if (historyMap[d] !== undefined) {
        scoreTracker = historyMap[d];
      }
      return {
        date: d,
        score: scoreTracker
      };
    });

    return res.json({ progressHistory: chartData });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy lịch sử tiến bộ cá nhân' });
  }
}

// Cảnh báo tự động cho GVCN & Học sinh (Cảnh báo khi < 80 điểm hoặc có > 2 vi phạm)
async function getSystemAlerts(req, res) {
  try {
    const alerts = await allQuery(`
      SELECT 
        s.id as student_id, s.full_name, s.student_code, g.group_name,
        100 + COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as current_score,
        COUNT(CASE WHEN et.category = 'PENALTY' THEN 1 END) as penalty_count
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      GROUP BY s.id
      HAVING current_score < 85 OR penalty_count >= 2
      ORDER BY current_score ASC
    `);

    const formattedAlerts = alerts.map(a => ({
      ...a,
      alert_type: a.current_score < 80 ? 'CRITICAL' : 'WARNING',
      message: a.current_score < 80 
        ? `Điểm nề nếp giảm sâu (${a.current_score}đ). Cần gặp riêng phụ huynh phối hợp!` 
        : `Có ${a.penalty_count} lượt vi phạm nề nếp trong tuần. Nhắc nhở điều chỉnh.`
    }));

    return res.json({ alerts: formattedAlerts });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách cảnh báo tự động' });
  }
}

module.exports = {
  getStudentBadges,
  getStudentProgressHistory,
  getSystemAlerts
};
