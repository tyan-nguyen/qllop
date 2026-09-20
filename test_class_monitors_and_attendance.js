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

async function testClassMonitorsAndAttendance() {
  console.log('=== TEST CLASS MONITORS (LOP TRUONG / LOP PHO) & ATTENDANCE ===\n');

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

  // Step 2: Get students
  console.log('\n[2] Fetching students of class 10B2...');
  const classDetails = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/details?class_id=${classId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });

  const studentA = classDetails.body.students.find(s => s.student_code === 'HS10B201');
  const studentB = classDetails.body.students.find(s => s.student_code === 'HS10B202');
  const studentC = classDetails.body.students.find(s => s.student_code === 'HS10B205');

  // Step 3: GVCN assigns HS10B201 as LOP_TRUONG and HS10B202 as LOP_PHO
  console.log('\n[3] GVCN assigns HS10B201 as Lớp Trưởng and HS10B202 as Lớp Phó...');
  const updateLtRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/students/${studentA.id}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    student_code: studentA.student_code,
    full_name: studentA.full_name,
    group_id: studentA.group_id,
    class_role: 'LOP_TRUONG'
  });
  console.log('Assign Lớp Trưởng status:', updateLtRes.status, updateLtRes.body.message);

  const updateLpRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/students/${studentB.id}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    student_code: studentB.student_code,
    full_name: studentB.full_name,
    group_id: studentB.group_id,
    class_role: 'LOP_PHO'
  });
  console.log('Assign Lớp Phó status:', updateLpRes.status, updateLpRes.body.message);

  // Step 4: Login as Lớp Trưởng HS10B201
  console.log('\n[4] Login as Lớp Trưởng HS10B201...');
  const ltLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'student', username: 'HS10B201', password: '123456' });

  console.log('Lớp Trưởng login status:', ltLogin.status, 'Class Role:', ltLogin.body.user.class_role, 'Is Monitor:', ltLogin.body.user.is_monitor);
  if (ltLogin.status !== 200 || ltLogin.body.user.class_role !== 'LOP_TRUONG' || !ltLogin.body.user.is_monitor) {
    throw new Error('Lớp Trưởng login payload mismatch');
  }
  const ltToken = ltLogin.body.token;

  // Step 5: Lớp Trưởng saves attendance
  console.log('\n[5] Lớp Trưởng HS10B201 records and saves class attendance...');
  const today = new Date().toISOString().split('T')[0];
  const saveAttRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/attendance',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ltToken}`
    }
  }, {
    date: today,
    class_id: classId,
    items: [
      { student_id: studentA.id, status: 'PRESENT', note: 'Có mặt' },
      { student_id: studentB.id, status: 'LATE', note: 'Đi trễ 10 phút' },
      { student_id: studentC.id, status: 'EXCUSED', note: 'Nghỉ có phép' }
    ]
  });
  console.log('Lớp Trưởng save attendance status:', saveAttRes.status, saveAttRes.body.message);
  if (saveAttRes.status !== 200) throw new Error('Lớp Trưởng save attendance failed');

  // Step 6: Login as Lớp Phó HS10B202 and verify attendance records
  console.log('\n[6] Login as Lớp Phó HS10B202 and query attendance...');
  const lpLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'student', username: 'HS10B202', password: '123456' });

  console.log('Lớp Phó login status:', lpLogin.status, 'Class Role:', lpLogin.body.user.class_role, 'Is Monitor:', lpLogin.body.user.is_monitor);
  if (lpLogin.status !== 200 || lpLogin.body.user.class_role !== 'LOP_PHO' || !lpLogin.body.user.is_monitor) {
    throw new Error('Lớp Phó login payload mismatch');
  }

  const lpAttQuery = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/attendance?date=${today}&class_id=${classId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${lpLogin.body.token}` }
  });
  console.log('Lớp Phó query attendance count:', lpAttQuery.body.attendance.length);
  const lateRecord = lpAttQuery.body.attendance.find(a => a.student_id === studentB.id);
  console.log('Late record verified:', lateRecord.status, lateRecord.note);
  if (!lateRecord || lateRecord.status !== 'LATE') throw new Error('Attendance data not saved accurately');

  // Step 7: Regular Student HS10B205 tries to save attendance -> forbidden
  console.log('\n[7] Regular Student HS10B205 tries to save attendance (should be 403 Forbidden)...');
  const normalLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'student', username: 'HS10B205', password: 'pass9999' });

  const normalToken = normalLogin.body.token;
  const unauthorizedRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/attendance',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${normalToken}`
    }
  }, {
    date: today,
    class_id: classId,
    items: [{ student_id: studentA.id, status: 'PRESENT' }]
  });
  console.log('Unauthorized save attendance status:', unauthorizedRes.status, unauthorizedRes.body.message);
  if (unauthorizedRes.status !== 403) throw new Error('Security check failed: Normal student could save attendance');

  console.log('\n======================================================================');
  console.log('🎉 ALL CLASS MONITORS (LT/LP) & ATTENDANCE TESTS PASSED 100%!');
  console.log('======================================================================');
}

testClassMonitorsAndAttendance().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
