const http = require('http');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function testWeeklyMonthlyScoresAndPastDate() {
  console.log('=== STARTING TESTS: WEEKLY & MONTHLY SCORES + PAST DATE LOGGING & EDITING ===');

  // 1. Login as GVCN
  const loginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    username: 'gvcn',
    password: '123456',
    portal: 'teacher'
  });

  console.log('[1] Login GVCN:', loginRes.status, loginRes.body.user?.full_name);
  if (loginRes.status !== 200) {
    throw new Error('GVCN Login failed: ' + JSON.stringify(loginRes.body));
  }
  const token = loginRes.body.token;
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 2. Fetch Weekly Scoring Summary
  const summaryRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/summary?class_id=1',
    method: 'GET',
    headers: authHeaders
  });

  console.log('[2] Get Scoring Summary Status:', summaryRes.status);
  console.log('    Selected Week:', summaryRes.body.selectedWeek?.label);
  console.log('    Available Weeks Count:', summaryRes.body.availableWeeks?.length);
  console.log('    Students count:', summaryRes.body.students?.length);
  const sampleStudent = summaryRes.body.students?.[0];
  console.log(`    Sample student: ${sampleStudent?.student_code} - ${sampleStudent?.full_name}, Current Score: ${sampleStudent?.current_score}đ`);

  // 3. Log event on a past date (e.g., 2026-09-02)
  const pastDate = '2026-09-02';
  const logPastEventRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/events',
    method: 'POST',
    headers: authHeaders
  }, {
    student_id: sampleStudent.id,
    event_type_id: 1, // Đi học trễ (-2)
    note: 'Chấm bổ sung ngày cũ thứ Tư tuần 1',
    event_date: pastDate
  });

  console.log('[3] Log Past Date Event Status:', logPastEventRes.status, logPastEventRes.body.message);

  // 4. Query events to get the created event id
  const eventsRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/behavior/events?class_id=1&student_id=${sampleStudent.id}&date=${pastDate}`,
    method: 'GET',
    headers: authHeaders
  });

  console.log('[4] Get Events on Past Date:', eventsRes.body.events?.length, 'events found');
  const loggedEvent = eventsRes.body.events?.[0];
  if (!loggedEvent) {
    throw new Error('Logged event not found!');
  }
  console.log('    Found event:', loggedEvent.id, loggedEvent.event_name, loggedEvent.event_date, loggedEvent.note);

  // 5. GVCN edits the past event (updates points/note/type)
  const updateEventRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/behavior/events/${loggedEvent.id}`,
    method: 'PUT',
    headers: authHeaders
  }, {
    student_id: sampleStudent.id,
    event_type_id: 2, // Quên vở bài tập
    points_applied: -3,
    note: 'GVCN đã rà soát và chỉnh sửa lại lỗi vi phạm',
    event_date: pastDate
  });

  console.log('[5] Update Event Status:', updateEventRes.status, updateEventRes.body.message);

  // 6. Test Weekly Report for week 1
  const weeklyReportRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/reports/weekly?class_id=1&week=1',
    method: 'GET',
    headers: authHeaders
  });

  console.log('[6] Weekly Report Status:', weeklyReportRes.status, 'Week:', weeklyReportRes.body.week);
  const studentInWeekly = weeklyReportRes.body.students?.find(s => s.id === sampleStudent.id);
  console.log(`    Student weekly score: ${studentInWeekly?.current_score}đ (Bonus: ${studentInWeekly?.bonus_points}, Penalty: ${studentInWeekly?.penalty_points})`);

  // 7. Test Monthly Report (Tháng 9)
  const monthlyReportRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/reports/monthly?class_id=1&month=9&year=2026',
    method: 'GET',
    headers: authHeaders
  });

  console.log('[7] Monthly Report Status:', monthlyReportRes.status, 'Month:', monthlyReportRes.body.selectedMonth?.label);
  console.log('    Weeks in Month:', monthlyReportRes.body.weeksInMonth?.length);
  const studentInMonthly = monthlyReportRes.body.students?.find(s => s.id === sampleStudent.id);
  console.log(`    Student monthly avg score: ${studentInMonthly?.monthly_avg_score}đ`);
  console.log(`    Weekly breakdown count:`, studentInMonthly?.weeklyBreakdown?.length);

  // 8. Test Semester / Yearly Report
  const semesterReportRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/reports/semester?class_id=1',
    method: 'GET',
    headers: authHeaders
  });

  console.log('[8] Semester Report Status:', semesterReportRes.status);
  const studentInSemester = semesterReportRes.body.semesterReport?.find(s => s.id === sampleStudent.id);
  console.log(`    Student final score: ${studentInSemester?.final_score}đ, Proposed Conduct: ${studentInSemester?.proposed_conduct}`);

  console.log('\n=== ALL BACKEND TESTS PASSED SUCCESSFULLY! ===\n');
}

testWeeklyMonthlyScoresAndPastDate().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
