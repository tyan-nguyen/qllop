/**
 * academicCalendar.js
 * Tiện ích tính toán lịch học, tuần, tháng và năm học cho hệ thống QLLOP
 */

/**
 * Định dạng Date object thành chuỗi 'YYYY-MM-DD'
 */
function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Lấy Thứ Hai (Monday) của tuần chứa ngày được truyền vào (hoặc ngày hiện tại)
 */
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  // Trong JS: 0 là Chủ nhật, 1 là Thứ 2, ..., 6 là Thứ 7
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Lấy Chủ Nhật (Sunday) của tuần chứa ngày được truyền vào
 */
function getSunday(d) {
  const monday = getMonday(d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

/**
 * Lấy khoảng ngày (Thứ 2 -> Chủ nhật) của tuần hiện tại hoặc theo ngày bất kỳ
 */
function getWeekRange(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const monday = getMonday(d);
  const sunday = getSunday(d);

  return {
    startDate: formatDate(monday),
    endDate: formatDate(sunday),
    monday,
    sunday
  };
}

/**
 * Xác định tuần thứ mấy trong năm học (Mặc định năm học bắt đầu từ 01/09)
 * @param {string|Date} dateInput
 * @param {string} schoolYear (VD: '2025-2026' hoặc '2026-2027')
 */
function getWeekNumberInSchoolYear(dateInput, schoolYear) {
  const d = dateInput ? new Date(dateInput) : new Date();
  let startYear = d.getFullYear();
  if (schoolYear && schoolYear.includes('-')) {
    startYear = parseInt(schoolYear.split('-')[0]);
  } else if (d.getMonth() < 7) {
    // Nếu từ tháng 1 đến tháng 7 thì năm học bắt đầu từ năm trước
    startYear = d.getFullYear() - 1;
  }

  // Ngày đầu tiên của năm học: 01/09 của startYear
  const schoolStart = new Date(startYear, 8, 1); // Tháng 9 là index 8
  const firstMonday = getMonday(schoolStart);

  const targetMonday = getMonday(d);
  const diffMs = targetMonday.getTime() - firstMonday.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

  const weekNumber = Math.max(1, diffWeeks + 1);
  return weekNumber;
}

/**
 * Tạo danh sách các tuần trong năm học (35 - 40 tuần chuẩn)
 */
function generateSchoolYearWeeks(schoolYear) {
  let startYear = new Date().getFullYear();
  if (schoolYear && schoolYear.includes('-')) {
    startYear = parseInt(schoolYear.split('-')[0]);
  } else if (new Date().getMonth() < 7) {
    startYear = new Date().getFullYear() - 1;
  }

  // Khởi đầu từ ngày 01/09 của startYear
  const schoolStart = new Date(startYear, 8, 1);
  let currentMonday = getMonday(schoolStart);

  const weeks = [];
  for (let i = 1; i <= 38; i++) {
    const sunday = new Date(currentMonday);
    sunday.setDate(currentMonday.getDate() + 6);

    weeks.push({
      weekNumber: i,
      weekLabel: `Tuần ${i}`,
      startDate: formatDate(currentMonday),
      endDate: formatDate(sunday),
      displayRange: `${String(currentMonday.getDate()).padStart(2, '0')}/${String(currentMonday.getMonth() + 1).padStart(2, '0')} - ${String(sunday.getDate()).padStart(2, '0')}/${String(sunday.getMonth() + 1).padStart(2, '0')}`
    });

    currentMonday.setDate(currentMonday.getDate() + 7);
  }

  return weeks;
}

/**
 * Lấy danh sách các tuần thuộc một tháng cụ thể
 * @param {number} month (1 - 12)
 * @param {number} year (VD: 2026)
 */
function getWeeksInMonth(month, year) {
  const y = year || new Date().getFullYear();
  const m = month - 1; // 0-indexed

  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);

  let currentMonday = getMonday(firstDay);
  const weeks = [];
  let wIndex = 1;

  while (currentMonday <= lastDay) {
    const sunday = new Date(currentMonday);
    sunday.setDate(currentMonday.getDate() + 6);

    weeks.push({
      weekIndexInMonth: wIndex,
      weekLabel: `Tuần ${wIndex} (Tháng ${month})`,
      startDate: formatDate(currentMonday),
      endDate: formatDate(sunday),
      displayRange: `${String(currentMonday.getDate()).padStart(2, '0')}/${String(currentMonday.getMonth() + 1).padStart(2, '0')} - ${String(sunday.getDate()).padStart(2, '0')}/${String(sunday.getMonth() + 1).padStart(2, '0')}`
    });

    wIndex++;
    currentMonday.setDate(currentMonday.getDate() + 7);
  }

  return weeks;
}

/**
 * Lấy danh sách 9 tháng của năm học (Tháng 9 -> Tháng 5 năm sau)
 */
function getAcademicMonths(schoolYear) {
  let startYear = new Date().getFullYear();
  if (schoolYear && schoolYear.includes('-')) {
    startYear = parseInt(schoolYear.split('-')[0]);
  } else if (new Date().getMonth() < 7) {
    startYear = new Date().getFullYear() - 1;
  }
  const endYear = startYear + 1;

  return [
    { month: 9, year: startYear, label: `Tháng 9/${startYear}`, semester: 1 },
    { month: 10, year: startYear, label: `Tháng 10/${startYear}`, semester: 1 },
    { month: 11, year: startYear, label: `Tháng 11/${startYear}`, semester: 1 },
    { month: 12, year: startYear, label: `Tháng 12/${startYear}`, semester: 1 },
    { month: 1, year: endYear, label: `Tháng 1/${endYear}`, semester: 1 },
    { month: 2, year: endYear, label: `Tháng 2/${endYear}`, semester: 2 },
    { month: 3, year: endYear, label: `Tháng 3/${endYear}`, semester: 2 },
    { month: 4, year: endYear, label: `Tháng 4/${endYear}`, semester: 2 },
    { month: 5, year: endYear, label: `Tháng 5/${endYear}`, semester: 2 }
  ];
}

module.exports = {
  formatDate,
  getMonday,
  getSunday,
  getWeekRange,
  getWeekNumberInSchoolYear,
  generateSchoolYearWeeks,
  getWeeksInMonth,
  getAcademicMonths
};
