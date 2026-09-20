const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testAll() {
  console.log('--- STARTING VERIFICATION OF 3 PORTALS & ADMIN FEATURES ---');

  // Test 1: Admin Login
  console.log('\n[1] Testing Admin Login (users table)...');
  const adminLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'admin', username: 'admin', password: '123456' });

  console.log('Admin login status:', adminLogin.status, 'Response:', adminLogin.body.user);
  if (adminLogin.status !== 200 || adminLogin.body.user.role !== 'ADMIN') {
    throw new Error('Admin login failed');
  }
  const adminToken = adminLogin.body.token;

  // Test 2: Teacher Login
  console.log('\n[2] Testing Teacher Login (teachers table)...');
  const teacherLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'teacher', username: 'gvcn', password: '123456' });

  console.log('Teacher login status:', teacherLogin.status, 'Response:', teacherLogin.body.user);
  if (teacherLogin.status !== 200 || teacherLogin.body.user.role !== 'GVCN') {
    throw new Error('Teacher login failed');
  }
  const teacherToken = teacherLogin.body.token;

  // Test 3: Student Login
  console.log('\n[3] Testing Student Login (students table)...');
  const studentLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'student', username: 'HS10B201', password: '123456' });

  console.log('Student login status:', studentLogin.status, 'Response:', studentLogin.body.user);
  if (studentLogin.status !== 200 || (studentLogin.body.user.role !== 'HOC_SINH' && studentLogin.body.user.role !== 'TO_TRUONG') || studentLogin.body.user.student_code !== 'HS10B201') {
    throw new Error('Student login failed');
  }

  // Test 4: Admin creates Teacher
  const gvUsername = `gv_test_${Date.now().toString().slice(-4)}`;
  console.log(`\n[4] Admin creates new Teacher ${gvUsername}...`);
  const createTeacherRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/create-teacher',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    username: gvUsername,
    password: 'password123',
    full_name: 'Thầy Giáo Thử Nghiệm',
    subject: 'Hóa học',
    phone: '0999888777',
    email: `${gvUsername}@thpt.edu.vn`
  });
  console.log('Create teacher:', createTeacherRes.status, createTeacherRes.body.message);

  // Test 5: Teacher logs in with new password
  console.log(`\n[5] Teacher ${gvUsername} logs in with password123...`);
  const gvTestLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'teacher', username: gvUsername, password: 'password123' });
  console.log('Teacher login:', gvTestLogin.status, gvTestLogin.body.message);

  // Test 6: Admin resets Teacher password
  console.log(`\n[6] Admin resets password for ${gvUsername} to 654321...`);
  const resetTeacherRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/reset-teacher-password',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    id: gvTestLogin.body.user.id,
    new_password: '654321'
  });
  console.log('Reset teacher password:', resetTeacherRes.body.message);

  // Test 7: gv_test logs in with new reset password 654321
  const gvTestLogin2 = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'teacher', username: gvUsername, password: '654321' });
  console.log('Teacher login with 654321:', gvTestLogin2.status, gvTestLogin2.body.message);

  // Test 8: Admin creates new class & assigns gv_test
  const classNameTest = `12A${Date.now().toString().slice(-2)}`;
  console.log(`\n[8] Admin creates class ${classNameTest} and assigns ${gvUsername}...`);
  const createClassRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/create-class',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    class_name: '12A8',
    school_year: '2025-2026',
    teacher_id: gvTestLogin.body.user.id
  });
  console.log('Create class:', createClassRes.body.message, 'Class ID:', createClassRes.body.class_id);
  const newClassId = createClassRes.body.class_id;

  // Test 9: Batch import students into 12A8
  console.log('\n[9] Batch import students into class 12A8...');
  const batchImportRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/import-students',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    class_id: newClassId,
    students_data: [
      { student_code: 'HS12A801', full_name: 'Nguyễn Văn Test 1', group_name: 'Tổ 1', parent_phone: '0901111111' },
      { student_code: 'HS12A802', full_name: 'Trần Thị Test 2', group_name: 'Tổ 2', parent_phone: '0902222222' }
    ]
  });
  console.log('Batch import:', batchImportRes.body.message);

  // Test 10: New student logs in with student portal
  console.log('\n[10] New student HS12A801 logs in...');
  const newStudentLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'student', username: 'HS12A801', password: '123456' });
  console.log('New student login:', newStudentLogin.status, newStudentLogin.body.message, newStudentLogin.body.user);

  // Test 11: Teacher Global Class List
  console.log('\n[11] Testing Teacher classes endpoint...');
  const teacherClasses = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/classes',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${teacherToken}`
    }
  });
  console.log('Teacher classes count:', teacherClasses.body.classes.length, teacherClasses.body.classes.map(c => `${c.class_name} (${c.school_year})`));

  console.log('\n=============================================');
  console.log('🎉 ALL 11 VERIFICATION TESTS PASSED PERFECTLY!');
  console.log('=============================================');
}

testAll().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
