const { runQuery, getQuery, allQuery } = require('../db/sqlite');
const {
  formatDate,
  getWeekRange,
  getWeekNumberInSchoolYear,
  generateSchoolYearWeeks,
  getWeeksInMonth,
  getAcademicMonths
} = require('../utils/academicCalendar');

// Lấy danh sách cấu hình sự kiện
async function getEventTypes(req, res) {
  try {
    const types = await allQuery(`SELECT * FROM event_types ORDER BY category DESC, id ASC`);
    return res.json({ eventTypes: types });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách sự kiện' });
  }
}

// Tạo danh mục sự kiện nề nếp mới
async function createEventType(req, res) {
  try {
    const { name, category, default_points, icon } = req.body;
    if (!name || !name.trim() || !category) {
      return res.status(400).json({ message: 'Vui lòng nhập tên quy định và phân loại (BONUS / PENALTY)' });
    }

    const cat = category.toUpperCase() === 'BONUS' ? 'BONUS' : 'PENALTY';
    let pts = parseInt(default_points);
    if (isNaN(pts)) {
      pts = cat === 'BONUS' ? 2 : -2;
    } else {
      if (cat === 'BONUS' && pts < 0) pts = -pts;
      if (cat === 'PENALTY' && pts > 0) pts = -pts;
    }

    const iconToUse = icon && icon.trim() ? icon.trim() : (cat === 'BONUS' ? '⭐' : '⚠️');

    const result = await runQuery(`
      INSERT INTO event_types (name, category, default_points, icon)
      VALUES (?, ?, ?, ?)
    `, [name.trim(), cat, pts, iconToUse]);

    return res.json({
      message: `Tạo quy định "${name.trim()}" thành công!`,
      eventType: {
        id: result.lastID,
        name: name.trim(),
        category: cat,
        default_points: pts,
        icon: iconToUse
      }
    });
  } catch (err) {
    console.error('Create event type error:', err);
    return res.status(500).json({ message: 'Lỗi tạo quy định nề nếp mới' });
  }
}

// Cập nhật danh mục sự kiện nề nếp
async function updateEventType(req, res) {
  try {
    const { id } = req.params;
    const { name, category, default_points, icon } = req.body;

    if (!id || !name || !name.trim()) {
      return res.status(400).json({ message: 'Vui lòng nhập tên quy định nề nếp' });
    }

    const eventType = await getQuery(`SELECT * FROM event_types WHERE id = ?`, [id]);
    if (!eventType) return res.status(404).json({ message: 'Không tìm thấy loại quy định cần sửa' });

    const cat = (category || eventType.category).toUpperCase() === 'BONUS' ? 'BONUS' : 'PENALTY';
    let pts = default_points !== undefined && default_points !== null && !isNaN(parseInt(default_points)) 
      ? parseInt(default_points) 
      : eventType.default_points;

    if (cat === 'BONUS' && pts < 0) pts = -pts;
    if (cat === 'PENALTY' && pts > 0) pts = -pts;

    const iconToUse = icon && icon.trim() ? icon.trim() : eventType.icon;

    await runQuery(`
      UPDATE event_types
      SET name = ?, category = ?, default_points = ?, icon = ?
      WHERE id = ?
    `, [name.trim(), cat, pts, iconToUse, id]);

    return res.json({ message: `Cập nhật quy định "${name.trim()}" thành công!` });
  } catch (err) {
    console.error('Update event type error:', err);
    return res.status(500).json({ message: 'Lỗi cập nhật quy định nề nếp' });
  }
}

// Xóa danh mục sự kiện nề nếp
async function deleteEventType(req, res) {
  try {
    const { id } = req.params;
    const eventType = await getQuery(`SELECT * FROM event_types WHERE id = ?`, [id]);
    if (!eventType) return res.status(404).json({ message: 'Không tìm thấy loại quy định cần xóa' });

    await runQuery(`DELETE FROM event_types WHERE id = ?`, [id]);
    return res.json({ message: `Đã xóa quy định "${eventType.name}" thành công!` });
  } catch (err) {
    console.error('Delete event type error:', err);
    return res.status(500).json({ message: 'Lỗi xóa quy định nề nếp' });
  }
}

// Ghi nhận sự kiện nề nếp (Hỗ trợ GVCN và Tổ Trưởng chấm chéo, hỗ trợ chọn ngày quá khứ)
async function logEvent(req, res) {
  try {
    const { student_id, event_type_id, note, event_date } = req.body;
    const currentUser = req.user;

    if (!student_id || !event_type_id) {
      return res.status(400).json({ message: 'Thiếu thông tin học sinh hoặc loại sự kiện' });
    }

    const student = await getQuery(`
      SELECT s.*, g.id as group_id, g.group_name 
      FROM students s 
      JOIN groups g ON s.group_id = g.id 
      WHERE s.id = ?
    `, [student_id]);

    if (!student) {
      return res.status(404).json({ message: 'Không tìm thấy học sinh' });
    }

    // RBAC & Ràng buộc chấm chéo dành cho Tổ Trưởng
    if (currentUser.role === 'TO_TRUONG') {
      const crossEval = await getQuery(`
        SELECT target_group_id FROM cross_eval_assignments WHERE evaluator_student_id = ?
      `, [currentUser.id]);

      const targetGroupId = crossEval ? crossEval.target_group_id : currentUser.assigned_target_group_id;

      if (!targetGroupId) {
        return res.status(403).json({
          message: 'Bạn chưa được Giáo viên chủ nhiệm phân công tổ chấm chéo. Vui lòng liên hệ GVCN.'
        });
      }

      if (student.group_id !== targetGroupId) {
        const targetGroup = await getQuery(`SELECT group_name FROM groups WHERE id = ?`, [targetGroupId]);
        return res.status(403).json({
          message: `Quy tắc phân quyền: Bạn chỉ được chấm điểm học sinh thuộc ${targetGroup?.group_name || 'tổ được phân công'}. Không được chấm tổ khác hoặc tổ của chính mình.`
        });
      }

      if (student.id === currentUser.id) {
        return res.status(403).json({ message: 'Tổ trưởng không được tự chấm điểm cho chính mình!' });
      }
    }

    const eventType = await getQuery(`SELECT * FROM event_types WHERE id = ?`, [event_type_id]);
    if (!eventType) {
      return res.status(404).json({ message: 'Loại sự kiện không hợp lệ' });
    }

    const dateStr = event_date ? event_date.trim() : formatDate(new Date());
    let recorderName = currentUser.full_name || 'Giáo viên';
    if (currentUser.role === 'TO_TRUONG') {
      recorderName = `${currentUser.full_name} (Tổ trưởng ${currentUser.group_name || 'Tổ'})`;
    }

    try {
      await runQuery(
        `INSERT INTO behavior_events (student_id, event_type_id, points_applied, note, event_date, created_by_teacher_id, created_by_name, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [student_id, event_type_id, eventType.default_points, note || '', dateStr, currentUser.id, recorderName, currentUser.id]
      );
    } catch (e) {
      await runQuery(
        `INSERT INTO behavior_events (student_id, event_type_id, points_applied, note, event_date, created_by_teacher_id, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [student_id, event_type_id, eventType.default_points, note || '', dateStr, currentUser.id, recorderName]
      );
    }

    return res.json({ message: 'Ghi nhận sự kiện nề nếp thành công!' });
  } catch (err) {
    console.error('Log event error:', err);
    return res.status(500).json({ message: 'Lỗi ghi nhận sự kiện nề nếp' });
  }
}

// Cập nhật / Sửa sự kiện nề nếp (Dành cho GVCN và Admin rà soát, chỉnh sửa ngày cũ hoặc lỗi nhập)
async function updateEvent(req, res) {
  try {
    const { id } = req.params;
    const { student_id, event_type_id, points_applied, note, event_date } = req.body;

    const event = await getQuery(`SELECT * FROM behavior_events WHERE id = ?`, [id]);
    if (!event) {
      return res.status(404).json({ message: 'Không tìm thấy sự kiện nề nếp cần chỉnh sửa' });
    }

    let pts = points_applied;
    if (pts === undefined || pts === null || isNaN(parseInt(pts))) {
      const et = await getQuery(`SELECT default_points FROM event_types WHERE id = ?`, [event_type_id || event.event_type_id]);
      pts = et ? et.default_points : event.points_applied;
    } else {
      pts = parseInt(pts);
    }

    const stId = student_id || event.student_id;
    const etId = event_type_id || event.event_type_id;
    const n = note !== undefined ? note : event.note;
    const dt = event_date ? event_date.trim() : event.event_date;

    await runQuery(`
      UPDATE behavior_events
      SET student_id = ?, event_type_id = ?, points_applied = ?, note = ?, event_date = ?
      WHERE id = ?
    `, [stId, etId, pts, n, dt, id]);

    return res.json({ message: 'Cập nhật sự kiện nề nếp thành công!' });
  } catch (err) {
    console.error('Update event error:', err);
    return res.status(500).json({ message: 'Lỗi cập nhật sự kiện nề nếp' });
  }
}

// Lấy lịch sử sự kiện nề nếp theo lớp, học sinh, tổ hoặc khoảng thời gian
async function getBehaviorEvents(req, res) {
  try {
    const { class_id, student_id, group_id, start_date, end_date, date } = req.query;

    let sql = `
      SELECT be.*, et.name as event_name, et.category, et.icon, s.full_name as student_name, s.student_code, g.group_name, be.created_by_name as recorder_name
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      JOIN students s ON be.student_id = s.id
      JOIN groups g ON s.group_id = g.id
      WHERE 1=1
    `;
    const params = [];

    if (class_id) {
      sql += ` AND s.class_id = ?`;
      params.push(class_id);
    }
    if (student_id) {
      sql += ` AND be.student_id = ?`;
      params.push(student_id);
    }
    if (group_id) {
      sql += ` AND s.group_id = ?`;
      params.push(group_id);
    }
    if (start_date && end_date) {
      sql += ` AND be.event_date BETWEEN ? AND ?`;
      params.push(start_date, end_date);
    } else if (date) {
      sql += ` AND be.event_date = ?`;
      params.push(date);
    }

    sql += ` ORDER BY be.event_date DESC, be.id DESC LIMIT 200`;

    const events = await allQuery(sql, params);
    return res.json({ events });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy lịch sử sự kiện nề nếp' });
  }
}

// Xóa sự kiện vi phạm / việc tốt (chỉ GVCN / Admin)
async function deleteEvent(req, res) {
  try {
    const { id } = req.params;
    await runQuery(`DELETE FROM behavior_events WHERE id = ?`, [id]);
    return res.json({ message: 'Đã xóa sự kiện' });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi xóa sự kiện' });
  }
}

// Lấy thông tin tổng quan tổ của Tổ trưởng (Dành riêng cho Tổ Trưởng - tính theo tuần hiện tại)
async function getMyGroupSummary(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser || (currentUser.portal !== 'student' && currentUser.role !== 'TO_TRUONG' && currentUser.role !== 'HOC_SINH')) {
      return res.status(400).json({ message: 'Yêu cầu đăng nhập tài khoản học sinh/tổ trưởng' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [currentUser.id]);
    if (!student) return res.status(404).json({ message: 'Không tìm thấy thông tin học sinh' });

    const classId = student.class_id;
    const currentClass = await getQuery(`SELECT * FROM classes WHERE id = ?`, [classId]);
    const schoolYear = currentClass?.school_year || '2025-2026';

    const weekRange = getWeekRange(new Date());
    const weekNumber = getWeekNumberInSchoolYear(new Date(), schoolYear);

    // 1. Tính điểm và xếp loại cho tất cả học sinh trong lớp theo TUẦN HIỆN TẠI (Xuất phát 100 điểm)
    const students = await allQuery(`
      SELECT 
        s.id, s.student_code, s.full_name, s.group_id, s.base_score, g.group_name,
        COALESCE(SUM(CASE WHEN et.category = 'BONUS' AND be.event_date BETWEEN ? AND ? THEN be.points_applied ELSE 0 END), 0) as total_bonus,
        COALESCE(SUM(CASE WHEN et.category = 'PENALTY' AND be.event_date BETWEEN ? AND ? THEN be.points_applied ELSE 0 END), 0) as total_penalty,
        COUNT(CASE WHEN et.category = 'BONUS' AND be.event_date BETWEEN ? AND ? THEN 1 END) as bonus_count,
        COUNT(CASE WHEN et.category = 'PENALTY' AND be.event_date BETWEEN ? AND ? THEN 1 END) as penalty_count
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      WHERE s.class_id = ?
      GROUP BY s.id
      ORDER BY s.student_code ASC
    `, [weekRange.startDate, weekRange.endDate, weekRange.startDate, weekRange.endDate, weekRange.startDate, weekRange.endDate, weekRange.startDate, weekRange.endDate, classId]);

    const studentSummaries = students.map(s => {
      // Mỗi đầu tuần điểm xuất phát từ 100 điểm
      const current_score = 100 + s.total_bonus + s.total_penalty;
      let rank_category = 'Cần cố gắng';
      if (current_score >= 95) rank_category = 'Xuất sắc';
      else if (current_score >= 85) rank_category = 'Tốt';
      else if (current_score >= 70) rank_category = 'Khá';
      else if (current_score >= 50) rank_category = 'Đạt';

      return {
        ...s,
        current_score,
        rank_category
      };
    });

    // 2. Tính xếp hạng các tổ trong tuần
    const allGroups = await allQuery(`SELECT id, group_name FROM groups WHERE class_id = ? ORDER BY id ASC`, [classId]);
    const groupSummaries = allGroups.map(g => {
      const gStudents = studentSummaries.filter(s => s.group_id === g.id);
      const totalScore = gStudents.reduce((sum, s) => sum + s.current_score, 0);
      const avgScore = gStudents.length > 0 ? parseFloat((totalScore / gStudents.length).toFixed(2)) : 0;
      
      let group_rank_category = 'Cần cố gắng';
      if (avgScore >= 95) group_rank_category = 'Xuất sắc';
      else if (avgScore >= 85) group_rank_category = 'Tốt';
      else if (avgScore >= 70) group_rank_category = 'Khá';
      else if (avgScore >= 50) group_rank_category = 'Đạt';

      return {
        group_id: g.id,
        group_name: g.group_name,
        student_count: gStudents.length,
        total_score: totalScore,
        avg_score: avgScore,
        group_rank_category
      };
    });

    groupSummaries.sort((a, b) => b.avg_score - a.avg_score);
    groupSummaries.forEach((g, idx) => {
      g.rank_position = idx + 1;
    });

    // 3. Thông tin tổ của tôi
    const myGroup = groupSummaries.find(g => g.group_id === student.group_id) || null;
    const myGroupMembers = studentSummaries.filter(s => s.group_id === student.group_id);

    // 4. Lấy phân công chấm chéo của tôi
    const crossAssignment = await getQuery(`
      SELECT cea.*, g.group_name as target_group_name
      FROM cross_eval_assignments cea
      JOIN groups g ON cea.target_group_id = g.id
      WHERE cea.evaluator_student_id = ?
    `, [currentUser.id]);

    let targetGroupStudents = [];
    if (crossAssignment) {
      targetGroupStudents = studentSummaries.filter(s => s.group_id === crossAssignment.target_group_id);
    }

    // 5. Lịch sử chấm điểm do chính tổ trưởng này ghi nhận
    const myLogs = await allQuery(`
      SELECT be.*, et.name as event_name, et.category, et.icon, s.full_name as student_name, s.student_code, g.group_name
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      JOIN students s ON be.student_id = s.id
      JOIN groups g ON s.group_id = g.id
      WHERE be.created_by_user_id = ? OR be.created_by_teacher_id = ?
      ORDER BY be.event_date DESC, be.id DESC LIMIT 50
    `, [currentUser.id, currentUser.id]);

    return res.json({
      weekInfo: {
        weekNumber,
        startDate: weekRange.startDate,
        endDate: weekRange.endDate,
        label: `Tuần ${weekNumber} (${weekRange.startDate} -> ${weekRange.endDate})`
      },
      student: {
        id: student.id,
        student_code: student.student_code,
        full_name: student.full_name,
        group_id: student.group_id,
        group_name: myGroup?.group_name || 'Tổ',
        class_role: student.class_role
      },
      myGroup: {
        ...myGroup,
        members: myGroupMembers
      },
      allGroups: groupSummaries,
      targetGroup: crossAssignment ? {
        id: crossAssignment.target_group_id,
        name: crossAssignment.target_group_name,
        students: targetGroupStudents
      } : null,
      myLogs
    });
  } catch (err) {
    console.error('Get my group summary error:', err);
    return res.status(500).json({ message: 'Lỗi lấy thông tin tổ của tôi' });
  }
}

// Tổng hợp điểm và xếp loại tự động theo Tuần / Tháng / Năm theo class_id
async function getScoringSummary(req, res) {
  try {
    const { class_id, week, start_date, end_date } = req.query;
    let targetClassId = class_id;
    if (!targetClassId) {
      const defaultClass = await getQuery(`SELECT id FROM classes ORDER BY school_year DESC, id ASC LIMIT 1`);
      targetClassId = defaultClass ? defaultClass.id : 1;
    }

    const currentClass = await getQuery(`SELECT * FROM classes WHERE id = ?`, [targetClassId]);
    const schoolYear = currentClass?.school_year || '2025-2026';
    const allAvailableWeeks = generateSchoolYearWeeks(schoolYear);

    // Xác định khoảng ngày của tuần cần xem
    let selectedWeekNumber = 1;
    let weekStartDate = '';
    let weekEndDate = '';

    if (start_date && end_date) {
      weekStartDate = start_date;
      weekEndDate = end_date;
      selectedWeekNumber = getWeekNumberInSchoolYear(start_date, schoolYear);
    } else if (week) {
      const wNum = parseInt(week);
      selectedWeekNumber = isNaN(wNum) ? 1 : wNum;
      const matchedWeek = allAvailableWeeks.find(w => w.weekNumber === selectedWeekNumber);
      if (matchedWeek) {
        weekStartDate = matchedWeek.startDate;
        weekEndDate = matchedWeek.endDate;
      } else {
        const wr = getWeekRange(new Date());
        weekStartDate = wr.startDate;
        weekEndDate = wr.endDate;
      }
    } else {
      // Mặc định là tuần hiện tại
      const wr = getWeekRange(new Date());
      weekStartDate = wr.startDate;
      weekEndDate = wr.endDate;
      selectedWeekNumber = getWeekNumberInSchoolYear(new Date(), schoolYear);
    }

    // 1. Lấy tất cả học sinh thuộc lớp kèm điểm cộng / trừ TRONG TUẦN ĐƯỢC CHỌN
    const students = await allQuery(`
      SELECT 
        s.id, s.student_code, s.full_name, s.group_id, s.base_score, g.group_name,
        COALESCE(SUM(CASE WHEN et.category = 'BONUS' AND be.event_date BETWEEN ? AND ? THEN be.points_applied ELSE 0 END), 0) as weekly_bonus,
        COALESCE(SUM(CASE WHEN et.category = 'PENALTY' AND be.event_date BETWEEN ? AND ? THEN be.points_applied ELSE 0 END), 0) as weekly_penalty,
        COUNT(CASE WHEN et.category = 'BONUS' AND be.event_date BETWEEN ? AND ? THEN 1 END) as weekly_bonus_count,
        COUNT(CASE WHEN et.category = 'PENALTY' AND be.event_date BETWEEN ? AND ? THEN 1 END) as weekly_penalty_count,
        COALESCE(SUM(CASE WHEN et.category = 'BONUS' THEN be.points_applied ELSE 0 END), 0) as total_all_bonus,
        COALESCE(SUM(CASE WHEN et.category = 'PENALTY' THEN be.points_applied ELSE 0 END), 0) as total_all_penalty
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      WHERE s.class_id = ?
      GROUP BY s.id
      ORDER BY s.student_code ASC
    `, [weekStartDate, weekEndDate, weekStartDate, weekEndDate, weekStartDate, weekEndDate, weekStartDate, weekEndDate, targetClassId]);

    // Tính điểm tuần (bắt đầu lại từ 100 điểm mỗi đầu tuần) và xếp loại cá nhân
    const studentSummaries = students.map(s => {
      const current_score = 100 + s.weekly_bonus + s.weekly_penalty;
      let rank_category = 'Cần cố gắng';
      if (current_score >= 95) rank_category = 'Xuất sắc';
      else if (current_score >= 85) rank_category = 'Tốt';
      else if (current_score >= 70) rank_category = 'Khá';
      else if (current_score >= 50) rank_category = 'Đạt';

      return {
        ...s,
        total_bonus: s.weekly_bonus,
        total_penalty: s.weekly_penalty,
        bonus_count: s.weekly_bonus_count,
        penalty_count: s.weekly_penalty_count,
        current_score,
        rank_category
      };
    });

    // 2. Tính tổng điểm và điểm trung bình cho từng Tổ của lớp TRONG TUẦN
    const groups = await allQuery(`SELECT id, group_name FROM groups WHERE class_id = ? ORDER BY id ASC`, [targetClassId]);
    const groupSummaries = groups.map(g => {
      const groupStudents = studentSummaries.filter(s => s.group_id === g.id);
      const totalScore = groupStudents.reduce((sum, s) => sum + s.current_score, 0);
      const avgScore = groupStudents.length > 0 ? parseFloat((totalScore / groupStudents.length).toFixed(2)) : 0;
      
      let group_rank_category = 'Cần cố gắng';
      if (avgScore >= 95) group_rank_category = 'Xuất sắc';
      else if (avgScore >= 85) group_rank_category = 'Tốt';
      else if (avgScore >= 70) group_rank_category = 'Khá';
      else if (avgScore >= 50) group_rank_category = 'Đạt';

      return {
        group_id: g.id,
        group_name: g.group_name,
        student_count: groupStudents.length,
        total_score: totalScore,
        avg_score: avgScore,
        group_rank_category
      };
    });

    groupSummaries.sort((a, b) => b.avg_score - a.avg_score);
    groupSummaries.forEach((g, idx) => {
      g.rank_position = idx + 1;
    });

    return res.json({
      class_id: parseInt(targetClassId),
      school_year: schoolYear,
      selectedWeek: {
        weekNumber: selectedWeekNumber,
        startDate: weekStartDate,
        endDate: weekEndDate,
        label: `Tuần ${selectedWeekNumber} (${weekStartDate} đến ${weekEndDate})`
      },
      availableWeeks: allAvailableWeeks,
      students: studentSummaries,
      groups: groupSummaries
    });
  } catch (err) {
    console.error('Error in scoring summary:', err);
    return res.status(500).json({ message: 'Lỗi tổng hợp điểm nề nếp' });
  }
}

module.exports = {
  getEventTypes,
  createEventType,
  updateEventType,
  deleteEventType,
  logEvent,
  updateEvent,
  getBehaviorEvents,
  deleteEvent,
  getMyGroupSummary,
  getScoringSummary
};
