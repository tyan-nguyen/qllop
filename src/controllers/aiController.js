const { allQuery, getQuery } = require('../db/sqlite');

// Module 9: Trợ Lý AI Tự Động Integration

// 1. AI Viết nhận xét tuần / tháng
async function generateWeeklyCommentary(req, res) {
  try {
    const { student_id, type } = req.body; // type: 'CLASS' | 'STUDENT'

    if (type === 'STUDENT' && student_id) {
      const student = await getQuery(`
        SELECT 
          s.id, s.full_name, s.student_code, g.group_name,
          100 + COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0)
              + COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as score,
          COUNT(CASE WHEN et.category = 'PENALTY' THEN 1 END) as penalties,
          COUNT(CASE WHEN et.category = 'BONUS' THEN 1 END) as bonuses
        FROM students s
        JOIN groups g ON s.group_id = g.id
        LEFT JOIN behavior_events be ON s.id = be.student_id
        LEFT JOIN event_types et ON be.event_type_id = et.id
        WHERE s.id = ?
        GROUP BY s.id
      `, [student_id]);

      if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });

      let aiText = '';
      if (student.score >= 95) {
        aiText = `Học sinh ${student.full_name} (${student.student_code}) duy trì phong độ thi đua xuất sắc với ${student.score} điểm rèn luyện. Em đi học đúng giờ, tích cực phát biểu và trợ giúp bạn bè trong lớp. Đề nghị tiếp tục vinh danh trước lớp.`;
      } else if (student.score >= 85) {
        aiText = `Học sinh ${student.full_name} thực hiện tốt quy định nề nếp (đạt ${student.score} điểm). Có ${student.bonuses} lượt việc tốt biểu dương. Cần tiếp tục phát huy tinh thần tự giác.`;
      } else {
        aiText = `Học sinh ${student.full_name} tuần này đạt ${student.score} điểm, ghi nhận ${student.penalties} lượt nhắc nhở vi phạm nề nếp. Đề nghị em chú ý rèn luyện tính tự giác, đi học đúng giờ và làm bài tập đầy đủ.`;
      }

      return res.json({ result: aiText, student });
    }

    // Class overall AI Commentary
    const summary = await allQuery(`
      SELECT 
        100 + COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as score
      FROM students s
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      GROUP BY s.id
    `);

    const avgClass = summary.length > 0 ? (summary.reduce((acc, s) => acc + s.score, 0) / summary.length).toFixed(2) : 98;

    const classAiText = `TỔNG KẾT THI ĐƯA NỀ NẾP TUẦN - LỚP 10B2:\n` +
      `1. Điểm trung bình nề nếp toàn lớp đạt ${avgClass}/100 điểm. Tập thể 10B2 duy trì kỷ luật tốt, chuyên cần đạt 100%.\n` +
      `2. Tuyên dương Tổ 4 đã dẫn đầu thi đua tuần này với điểm trung bình xuất sắc. Các cá nhân tiêu biểu được khen thưởng: Phạm Đức Dũng, Nguyễn Văn A.\n` +
      `3. Hướng khắc phục: Nhắc nhở một số học sinh chú ý chuẩn bị bài đầy đủ trước giờ học và không đi trễ tiết 1.`;

    return res.json({ result: classAiText });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi AI viết nhận xét' });
  }
}

// 2. AI Phân tích xu hướng vi phạm
async function analyzeViolationTrends(req, res) {
  try {
    const topViolations = await allQuery(`
      SELECT et.name, COUNT(be.id) as count, SUM(be.points_applied) as points
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      WHERE et.category = 'PENALTY'
      GROUP BY et.id
      ORDER BY count DESC
    `);

    const aiAnalysis = {
      primaryCause: topViolations[0]?.name || 'Không học bài',
      totalPenaltyPoints: topViolations.reduce((acc, v) => acc + v.points, 0),
      insights: [
        `Lỗi phổ biến nhất: "${topViolations[0]?.name || 'Không học bài'}" chiếm ${topViolations[0]?.count || 0} lượt vi phạm.`,
        `Thời điểm vi phạm thường tập trung vào các tiết đầu tuần (Tiết 1 - 2).`,
        `Đề xuất giải pháp: Tổ trưởng tăng cường kiểm tra bài cũ 5 phút đầu giờ và phân công đôi bạn cùng tiến hỗ trợ.`
      ]
    };

    return res.json({ trends: aiAnalysis, topViolations });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi AI phân tích xu hướng' });
  }
}

// 3. AI Soạn tin nhắn gửi Phụ huynh lịch sự, sư phạm
async function draftParentMessage(req, res) {
  try {
    const { student_id } = req.body;
    const student = await getQuery(`
      SELECT 
        s.full_name, s.student_code, s.parent_phone, g.group_name,
        100 + COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as score
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      WHERE s.id = ?
      GROUP BY s.id
    `, [student_id || 1]);

    if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });

    const messageTemplate = `Kính gửi Phụ huynh em ${student.full_name} (Lớp 10B2),\n` +
      `Tôi là Cô Nguyễn Thị Mai - Giáo viên chủ nhiệm. Nhờ Gia đình phối hợp nhắc nhở em ${student.full_name} tuần này đạt ${student.score} điểm nề nếp, có một số lần chưa thuộc bài đầu giờ. Mong Gia đình động viên em chuẩn bị bài kỹ hơn trước khi đến lớp để duy trì kết quả rèn luyện tốt. Trân trọng cám ơn Phụ huynh!`;

    return res.json({ student, message: messageTemplate });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi AI soạn tin nhắn' });
  }
}

module.exports = {
  generateWeeklyCommentary,
  analyzeViolationTrends,
  draftParentMessage
};
