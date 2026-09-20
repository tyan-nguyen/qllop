const { allQuery, getQuery } = require('../db/sqlite');
const {
  formatDate,
  getWeekRange,
  getWeekNumberInSchoolYear,
  generateSchoolYearWeeks,
  getWeeksInMonth,
  getAcademicMonths
} = require('../utils/academicCalendar');

// 1. Báo cáo Thi Đua Tuần (Module 6) theo class_id & week
async function getWeeklyReport(req, res) {
  try {
    const { class_id, week, start_date, end_date } = req.query;

    let targetClassId = class_id;
    if (!targetClassId) {
      const defaultClass = await getQuery(`SELECT id FROM classes ORDER BY school_year DESC, id ASC LIMIT 1`);
      targetClassId = defaultClass ? defaultClass.id : 1;
    }

    const currentClass = await getQuery(`
      SELECT c.*, t.full_name as teacher_name
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.id
      WHERE c.id = ?
    `, [targetClassId]);

    const schoolYear = currentClass?.school_year || '2025-2026';
    const allAvailableWeeks = generateSchoolYearWeeks(schoolYear);

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
      const wr = getWeekRange(new Date());
      weekStartDate = wr.startDate;
      weekEndDate = wr.endDate;
      selectedWeekNumber = getWeekNumberInSchoolYear(new Date(), schoolYear);
    }

    // Lấy danh sách học sinh và điểm cộng/trừ trong tuần được chọn (khởi đầu 100đ)
    const students = await allQuery(`
      SELECT 
        s.id, s.student_code, s.full_name, g.group_name, s.base_score,
        COALESCE(SUM(CASE WHEN et.category = 'BONUS' AND be.event_date BETWEEN ? AND ? THEN be.points_applied ELSE 0 END), 0) as bonus_points,
        COALESCE(SUM(CASE WHEN et.category = 'PENALTY' AND be.event_date BETWEEN ? AND ? THEN be.points_applied ELSE 0 END), 0) as penalty_points
      FROM students s
      JOIN groups g ON s.group_id = g.id
      LEFT JOIN behavior_events be ON s.id = be.student_id
      LEFT JOIN event_types et ON be.event_type_id = et.id
      WHERE s.class_id = ?
      GROUP BY s.id
      ORDER BY s.student_code ASC
    `, [weekStartDate, weekEndDate, weekStartDate, weekEndDate, targetClassId]);

    const studentList = students.map(s => {
      // Mỗi đầu tuần điểm reset 100
      const current_score = 100 + s.bonus_points + s.penalty_points;
      let rank_category = 'Cần cố gắng';
      if (current_score >= 95) rank_category = 'Xuất sắc';
      else if (current_score >= 85) rank_category = 'Tốt';
      else if (current_score >= 70) rank_category = 'Khá';
      else if (current_score >= 50) rank_category = 'Đạt';
      return { ...s, current_score, rank_category };
    });

    // Bảng xếp hạng các tổ trong tuần
    const groups = await allQuery(`SELECT id, group_name FROM groups WHERE class_id = ?`, [targetClassId]);
    const groupSummaries = groups.map(g => {
      const gStudents = studentList.filter(s => s.group_name === g.group_name);
      const total = gStudents.reduce((sum, s) => sum + s.current_score, 0);
      const avg = gStudents.length > 0 ? parseFloat((total / gStudents.length).toFixed(2)) : 0;
      return { group_name: g.group_name, avg_score: avg, student_count: gStudents.length };
    });
    groupSummaries.sort((a, b) => b.avg_score - a.avg_score);
    groupSummaries.forEach((g, idx) => g.rank = idx + 1);

    // Top vi phạm & tuyên dương trong tuần này
    const topViolations = await allQuery(`
      SELECT et.name, COUNT(be.id) as count, SUM(be.points_applied) as total_penalty
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      JOIN students s ON be.student_id = s.id
      WHERE et.category = 'PENALTY' AND s.class_id = ? AND be.event_date BETWEEN ? AND ?
      GROUP BY et.id
      ORDER BY count DESC LIMIT 5
    `, [targetClassId, weekStartDate, weekEndDate]);

    const topGoodDeeds = await allQuery(`
      SELECT et.name, COUNT(be.id) as count, SUM(be.points_applied) as total_bonus
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      JOIN students s ON be.student_id = s.id
      WHERE et.category = 'BONUS' AND s.class_id = ? AND be.event_date BETWEEN ? AND ?
      GROUP BY et.id
      ORDER BY count DESC LIMIT 5
    `, [targetClassId, weekStartDate, weekEndDate]);

    return res.json({
      class_id: parseInt(targetClassId),
      school_year: schoolYear,
      week: selectedWeekNumber,
      selectedWeek: {
        weekNumber: selectedWeekNumber,
        startDate: weekStartDate,
        endDate: weekEndDate,
        label: `Tuần ${selectedWeekNumber} (${weekStartDate} đến ${weekEndDate})`
      },
      availableWeeks: allAvailableWeeks,
      students: studentList,
      groups: groupSummaries,
      topViolations,
      topGoodDeeds
    });
  } catch (err) {
    console.error('Weekly report error:', err);
    return res.status(500).json({ message: 'Lỗi lấy báo cáo tuần' });
  }
}

// 2. Báo cáo Thi Đua Tháng (MỚI: Điểm Tháng = Bình quân các tuần trong tháng)
async function getMonthlyReport(req, res) {
  try {
    const { class_id, month, year } = req.query;

    let targetClassId = class_id;
    if (!targetClassId) {
      const defaultClass = await getQuery(`SELECT id FROM classes ORDER BY school_year DESC, id ASC LIMIT 1`);
      targetClassId = defaultClass ? defaultClass.id : 1;
    }

    const currentClass = await getQuery(`
      SELECT c.*, t.full_name as teacher_name
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.id
      WHERE c.id = ?
    `, [targetClassId]);

    const schoolYear = currentClass?.school_year || '2025-2026';
    const academicMonths = getAcademicMonths(schoolYear);

    const now = new Date();
    const targetMonth = month ? parseInt(month) : (now.getMonth() + 1);
    const targetYear = year ? parseInt(year) : (targetMonth < 8 && schoolYear.includes('-') ? parseInt(schoolYear.split('-')[1]) : parseInt(schoolYear.split('-')[0] || now.getFullYear()));

    const weeksInMonth = getWeeksInMonth(targetMonth, targetYear);

    // Lấy danh sách tất cả học sinh trong lớp
    const students = await allQuery(`
      SELECT s.id, s.student_code, s.full_name, g.group_name
      FROM students s
      JOIN groups g ON s.group_id = g.id
      WHERE s.class_id = ?
      ORDER BY s.student_code ASC
    `, [targetClassId]);

    // Lấy tất cả sự kiện nề nếp trong tháng
    const firstWeekStart = weeksInMonth[0]?.startDate || `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
    const lastWeekEnd = weeksInMonth[weeksInMonth.length - 1]?.endDate || `${targetYear}-${String(targetMonth).padStart(2, '0')}-31`;

    const allEvents = await allQuery(`
      SELECT be.student_id, be.event_date, be.points_applied, et.category
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      JOIN students s ON be.student_id = s.id
      WHERE s.class_id = ? AND be.event_date BETWEEN ? AND ?
    `, [targetClassId, firstWeekStart, lastWeekEnd]);

    // Tính điểm từng tuần cho từng học sinh và điểm bình quân tháng
    const studentMonthlyScores = students.map(s => {
      const sEvents = allEvents.filter(e => e.student_id === s.id);
      const weeklyBreakdown = [];
      let totalWeekScore = 0;

      weeksInMonth.forEach(w => {
        const eventsInWeek = sEvents.filter(e => e.event_date >= w.startDate && e.event_date <= w.endDate);
        const bonus = eventsInWeek.filter(e => e.category === 'BONUS').reduce((sum, e) => sum + e.points_applied, 0);
        const penalty = eventsInWeek.filter(e => e.category === 'PENALTY').reduce((sum, e) => sum + e.points_applied, 0);
        const weekScore = 100 + bonus + penalty;

        weeklyBreakdown.push({
          weekLabel: w.weekLabel,
          weekRange: w.displayRange,
          bonus,
          penalty,
          score: weekScore
        });
        totalWeekScore += weekScore;
      });

      const numWeeks = weeksInMonth.length || 1;
      const monthlyAvg = parseFloat((totalWeekScore / numWeeks).toFixed(2));

      let rank_category = 'Cần cố gắng';
      if (monthlyAvg >= 95) rank_category = 'Xuất sắc';
      else if (monthlyAvg >= 85) rank_category = 'Tốt';
      else if (monthlyAvg >= 70) rank_category = 'Khá';
      else if (monthlyAvg >= 50) rank_category = 'Đạt';

      return {
        ...s,
        weeklyBreakdown,
        monthly_avg_score: monthlyAvg,
        rank_category
      };
    });

    // Tính điểm bình quân tháng cho từng tổ
    const groups = await allQuery(`SELECT id, group_name FROM groups WHERE class_id = ?`, [targetClassId]);
    const groupSummaries = groups.map(g => {
      const gStudents = studentMonthlyScores.filter(s => s.group_name === g.group_name);
      const total = gStudents.reduce((sum, s) => sum + s.monthly_avg_score, 0);
      const avg = gStudents.length > 0 ? parseFloat((total / gStudents.length).toFixed(2)) : 0;
      return { group_name: g.group_name, avg_score: avg, student_count: gStudents.length };
    });
    groupSummaries.sort((a, b) => b.avg_score - a.avg_score);
    groupSummaries.forEach((g, idx) => g.rank = idx + 1);

    return res.json({
      class_id: parseInt(targetClassId),
      school_year: schoolYear,
      selectedMonth: {
        month: targetMonth,
        year: targetYear,
        label: `Tháng ${targetMonth}/${targetYear}`
      },
      academicMonths,
      weeksInMonth,
      students: studentMonthlyScores,
      groups: groupSummaries
    });
  } catch (err) {
    console.error('Monthly report error:', err);
    return res.status(500).json({ message: 'Lỗi lấy báo cáo tháng' });
  }
}

// 3. Báo cáo Cuối Tháng & Học Kỳ / Cả Năm (Điểm Năm = Bình quân các tháng trong năm)
async function getSemesterReport(req, res) {
  try {
    const { class_id, semester } = req.query; // semester: 1 | 2 | 'ALL'

    let targetClassId = class_id;
    if (!targetClassId) {
      const defaultClass = await getQuery(`SELECT id FROM classes ORDER BY school_year DESC, id ASC LIMIT 1`);
      targetClassId = defaultClass ? defaultClass.id : 1;
    }

    const currentClass = await getQuery(`
      SELECT c.*, t.full_name as teacher_name
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.id
      WHERE c.id = ?
    `, [targetClassId]);

    const schoolYear = currentClass?.school_year || '2025-2026';
    let academicMonths = getAcademicMonths(schoolYear);

    if (semester === '1') {
      academicMonths = academicMonths.filter(m => m.semester === 1);
    } else if (semester === '2') {
      academicMonths = academicMonths.filter(m => m.semester === 2);
    }

    // Lấy tất cả học sinh trong lớp
    const students = await allQuery(`
      SELECT s.id, s.student_code, s.full_name, g.group_name
      FROM students s
      JOIN groups g ON s.group_id = g.id
      WHERE s.class_id = ?
      ORDER BY s.student_code ASC
    `, [targetClassId]);

    // Lấy tất cả sự kiện nề nếp trong năm học
    const allEvents = await allQuery(`
      SELECT be.student_id, be.event_date, be.points_applied, et.category
      FROM behavior_events be
      JOIN event_types et ON be.event_type_id = et.id
      JOIN students s ON be.student_id = s.id
      WHERE s.class_id = ?
    `, [targetClassId]);

    // Tính điểm từng tháng cho từng học sinh, rồi tính bình quân năm/học kỳ
    const studentSemesterScores = students.map(s => {
      const sEvents = allEvents.filter(e => e.student_id === s.id);
      const monthlyBreakdown = [];
      let totalMonthsScore = 0;

      academicMonths.forEach(m => {
        const weeksInM = getWeeksInMonth(m.month, m.year);
        let monthWeekTotal = 0;

        weeksInM.forEach(w => {
          const eventsInW = sEvents.filter(e => e.event_date >= w.startDate && e.event_date <= w.endDate);
          const bonus = eventsInW.filter(e => e.category === 'BONUS').reduce((sum, e) => sum + e.points_applied, 0);
          const penalty = eventsInW.filter(e => e.category === 'PENALTY').reduce((sum, e) => sum + e.points_applied, 0);
          monthWeekTotal += (100 + bonus + penalty);
        });

        const monthAvg = parseFloat((monthWeekTotal / (weeksInM.length || 1)).toFixed(2));
        monthlyBreakdown.push({
          monthLabel: m.label,
          month: m.month,
          year: m.year,
          semester: m.semester,
          score: monthAvg
        });

        totalMonthsScore += monthAvg;
      });

      const numMonths = academicMonths.length || 1;
      const finalScore = parseFloat((totalMonthsScore / numMonths).toFixed(2));

      let proposed_conduct = 'Chưa đạt'; // Đề nghị Hạnh kiểm
      if (finalScore >= 85) proposed_conduct = 'Tốt';
      else if (finalScore >= 70) proposed_conduct = 'Khá';
      else if (finalScore >= 50) proposed_conduct = 'Đạt';

      return {
        ...s,
        monthlyBreakdown,
        final_score: finalScore,
        proposed_conduct
      };
    });

    return res.json({
      class_id: parseInt(targetClassId),
      school_year: schoolYear,
      semester: semester || 'ALL',
      months: academicMonths,
      semesterReport: studentSemesterScores
    });
  } catch (err) {
    console.error('Semester/Yearly report error:', err);
    return res.status(500).json({ message: 'Lỗi lấy báo cáo học kỳ/năm' });
  }
}

module.exports = {
  getWeeklyReport,
  getMonthlyReport,
  getSemesterReport
};
