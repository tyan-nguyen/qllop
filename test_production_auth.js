const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ HỆ THỐNG ĐĂNG NHẬP THẬT & PHÂN QUYỀN RBAC ===\n');
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // 1. Kiểm tra tắt endpoint test-users
  console.log('--- 1. Kiểm tra gỡ bỏ API tài khoản thử nghiệm (/auth/test-users) ---');
  const resTestUsers = await fetch(`${BASE_URL}/auth/test-users`);
  assert(resTestUsers.status === 404, `Endpoint /auth/test-users đã bị gỡ bỏ hoàn toàn (HTTP ${resTestUsers.status})`);

  // 2. Kiểm tra Đăng nhập Admin
  console.log('\n--- 2. Kiểm tra Đăng nhập Cổng Quản trị viên (Admin) ---');
  const resAdminLogin = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portal: 'admin', username: 'admin', password: '123456' })
  });
  const dataAdmin = await resAdminLogin.json();
  assert(resAdminLogin.status === 200 && dataAdmin.token && dataAdmin.user.role === 'ADMIN', 'Admin đăng nhập thành công với tài khoản thật');

  const adminToken = dataAdmin.token;

  // Kiểm tra Admin truy cập quyền Quản trị
  const resAdminOverview = await fetch(`${BASE_URL}/admin/overview`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(resAdminOverview.status === 200, 'Admin có quyền truy cập /admin/overview');

  // 3. Kiểm tra Đăng nhập Giáo viên Chủ nhiệm (GVCN)
  console.log('\n--- 3. Kiểm tra Đăng nhập Cổng GVCN ---');
  const resTeacherLogin = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portal: 'teacher', username: 'gvcn', password: '123456' })
  });
  const dataTeacher = await resTeacherLogin.json();
  assert(resTeacherLogin.status === 200 && dataTeacher.token && dataTeacher.user.role === 'GVCN', 'GVCN đăng nhập thành công với tài khoản thật');

  const teacherToken = dataTeacher.token;

  // GVCN truy cập lớp được phân công
  const resTeacherClasses = await fetch(`${BASE_URL}/auth/classes`, {
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const dataClasses = await resTeacherClasses.json();
  assert(resTeacherClasses.status === 200 && dataClasses.classes.length > 0, `GVCN load được danh sách lớp được phân công (${dataClasses.classes.length} lớp)`);

  // GVCN bị chặn khi truy cập trái phép vào API Admin
  const resTeacherToAdmin = await fetch(`${BASE_URL}/admin/overview`, {
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  assert(resTeacherToAdmin.status === 403, 'GVCN bị chặn (403 Forbidden) khi cố truy cập /admin/overview');

  // 4. Kiểm tra Đăng nhập Học sinh (Lớp trưởng / Tổ trưởng)
  console.log('\n--- 4. Kiểm tra Đăng nhập Cổng Học sinh (Lớp trưởng / Tổ trưởng) ---');
  const resStudentLogin = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portal: 'student', username: 'HS10B201', password: '123456' })
  });
  const dataStudent = await resStudentLogin.json();
  assert(
    resStudentLogin.status === 200 &&
    dataStudent.user.student_code === 'HS10B201' &&
    dataStudent.user.class_role === 'LOP_TRUONG' &&
    dataStudent.user.is_group_leader === true,
    'Học sinh HS10B201 đăng nhập thành công và nhận diện chính xác chức vụ Lớp trưởng + Tổ trưởng'
  );

  const studentToken = dataStudent.token;

  // Học sinh bị chặn khi cố truy cập API Admin
  const resStudentToAdmin = await fetch(`${BASE_URL}/admin/overview`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert(resStudentToAdmin.status === 403, 'Học sinh bị chặn (403 Forbidden) khi cố truy cập /admin/overview');

  // Lớp trưởng có quyền điểm danh lớp học của mình
  const resStudentAttendance = await fetch(`${BASE_URL}/attendance?class_id=${dataStudent.user.class_id}`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert(resStudentAttendance.status === 200, 'Lớp trưởng có quyền tra cứu / điểm danh lớp mình');

  // 5. Kiểm tra bảo mật mật khẩu sai / tài khoản không tồn tại
  console.log('\n--- 5. Kiểm tra Từ chối đăng nhập sai mật khẩu ---');
  const resWrongPass = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portal: 'teacher', username: 'gvcn', password: 'wrongpassword' })
  });
  assert(resWrongPass.status === 400, 'Hệ thống từ chối đăng nhập khi nhập sai mật khẩu (HTTP 400)');

  console.log(`\n===================================================`);
  console.log(`KẾT QUẢ KIỂM THỬ: ${passed}/${total} BƯỚC ĐẠT CHUẨN`);
  console.log(`===================================================`);
}

runTests().catch(err => {
  console.error('Lỗi khi chạy kiểm thử:', err);
});
