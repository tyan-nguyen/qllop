const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...options.headers };
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ ...options, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function testStudentAndEventConfig() {
  console.log('=== TEST STUDENT EDIT & EVENT TYPE CONFIGURATION ===\n');

  // Step 1: Login GVCN
  console.log('[1] Logging in as GVCN...');
  const teacherLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'teacher', username: 'gvcn', password: '123456' });

  if (teacherLogin.status !== 200) throw new Error('GVCN login failed');
  const teacherToken = teacherLogin.body.token;
  const classId = teacherLogin.body.classes[0].id;
  console.log('GVCN logged in. Class ID:', classId);

  // Step 2: Get student HS10B205 to edit
  console.log('\n[2] Fetching students of class...');
  const classDetails = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/details?class_id=${classId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const targetStudent = classDetails.body.students.find(s => s.student_code === 'HS10B205');
  if (!targetStudent) throw new Error('Target student HS10B205 not found');
  console.log('Target student found:', targetStudent.student_code, targetStudent.full_name);

  // Step 3: GVCN edits student HS10B205
  console.log('\n[3] GVCN updates student HS10B205 (name, phone, base_score, new password: pass9999)...');
  const updateStudentRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/students/${targetStudent.id}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    student_code: 'HS10B205',
    full_name: 'Huỳnh Ngọc Hà (Đã cập nhật)',
    group_id: targetStudent.group_id,
    parent_phone: '0988111222',
    base_score: 95,
    password: 'pass9999'
  });
  console.log('Update student status:', updateStudentRes.status, updateStudentRes.body.message);
  if (updateStudentRes.status !== 200) throw new Error('Update student failed');

  // Step 4: Student logs in with new password
  console.log('\n[4] Student HS10B205 logs in with new password pass9999...');
  const studentLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'student', username: 'HS10B205', password: 'pass9999' });

  console.log('Student login status:', studentLogin.status, 'Full Name:', studentLogin.body.user.full_name, 'Base Score:', studentLogin.body.user.base_score);
  if (studentLogin.status !== 200 || studentLogin.body.user.full_name !== 'Huỳnh Ngọc Hà (Đã cập nhật)' || studentLogin.body.user.base_score !== 95) {
    throw new Error('Student login with new password or updated data failed');
  }

  // Step 5: Event Types Config - Create new event type
  console.log('\n[5] GVCN creates new event type "Đạt giải Nhất HSG cấp Trường"...');
  const createEtRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/event-types',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    name: 'Đạt giải Nhất HSG cấp Trường',
    category: 'BONUS',
    default_points: 10,
    icon: '🏆'
  });
  console.log('Create event type status:', createEtRes.status, createEtRes.body.message);
  if (createEtRes.status !== 200) throw new Error('Create event type failed');
  const newEtId = createEtRes.body.eventType.id;

  // Step 6: Event Types Config - Update existing event type
  console.log('\n[6] GVCN updates event type (renaming and changing points to 15)...');
  const updateEtRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/behavior/event-types/${newEtId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    name: 'Đạt giải Nhất HSG Tỉnh / TP',
    category: 'BONUS',
    default_points: 15,
    icon: '👑'
  });
  console.log('Update event type status:', updateEtRes.status, updateEtRes.body.message);
  if (updateEtRes.status !== 200) throw new Error('Update event type failed');

  // Step 7: Log event with new event type
  console.log('\n[7] GVCN logs updated bonus event (+15đ) for student HS10B205...');
  const logEventRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/events',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    student_id: targetStudent.id,
    event_type_id: newEtId,
    note: 'Giải Nhất môn Toán cấp Thành phố'
  });
  console.log('Log event status:', logEventRes.status, logEventRes.body.message);
  if (logEventRes.status !== 200) throw new Error('Log event with new type failed');

  // Step 8: Verify student score reflects new bonus
  console.log('\n[8] Verifying student summary score calculation...');
  const summaryRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/behavior/summary?class_id=${classId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const updatedStudentSummary = summaryRes.body.students.find(s => s.id === targetStudent.id);
  console.log('Updated student current score:', updatedStudentSummary.current_score, 'Base:', updatedStudentSummary.base_score, 'Total Bonus:', updatedStudentSummary.total_bonus);
  if (updatedStudentSummary.current_score !== 95 + 15) {
    throw new Error('Score calculation with new event type points mismatch');
  }

  // Step 9: Delete test event type
  console.log('\n[9] GVCN deletes test event type...');
  const deleteEtRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/behavior/event-types/${newEtId}`,
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${teacherToken}`
    }
  });
  console.log('Delete event type status:', deleteEtRes.status, deleteEtRes.body.message);
  if (deleteEtRes.status !== 200) throw new Error('Delete event type failed');

  console.log('\n=============================================================');
  console.log('🎉 ALL STUDENT EDIT & EVENT TYPE CONFIG TESTS PASSED 100%!');
  console.log('=============================================================');
}

testStudentAndEventConfig().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
