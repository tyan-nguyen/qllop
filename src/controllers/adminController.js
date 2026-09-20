const bcrypt = require('bcryptjs');
const { runQuery, getQuery, allQuery } = require('../db/sqlite');

// ==========================================
// 1. TỔNG QUAN HỆ THỐNG DÀNH CHO ADMIN
// ==========================================
async function getAdminOverview(req, res) {
  try {
    const adminCount = await getQuery(`SELECT COUNT(*) as count FROM users`);
    const teacherCount = await getQuery(`SELECT COUNT(*) as count FROM teachers`);
    const classCount = await getQuery(`SELECT COUNT(*) as count FROM classes`);
    const studentCount = await getQuery(`SELECT COUNT(*) as count FROM students`);

    const classes = await allQuery(`
      SELECT c.*, t.full_name as teacher_name, t.username as teacher_username, COUNT(s.id) as student_count
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.id
      LEFT JOIN students s ON c.id = s.class_id
      GROUP BY c.id
      ORDER BY c.school_year DESC, c.class_name ASC
    `);

    const teachers = await allQuery(`
      SELECT t.id, t.username, t.full_name, t.phone, t.email, t.subject, t.created_at,
             GROUP_CONCAT(c.class_name, ', ') as assigned_classes
      FROM teachers t
      LEFT JOIN classes c ON t.id = c.teacher_id
      GROUP BY t.id
      ORDER BY t.id DESC
    `);

    return res.json({
      stats: {
        totalAdmins: adminCount.count,
        totalTeachers: teacherCount.count,
        totalClasses: classCount.count,
        totalStudents: studentCount.count
      },
      classes,
      teachers
    });
  } catch (err) {
    console.error('Get admin overview error:', err);
    return res.status(500).json({ message: 'Lỗi lấy thông tin tổng quan Admin' });
  }
}

// ==========================================
// 2. QUẢN LÝ TÀI KHOẢN ADMIN (BẢNG users)
// ==========================================
async function getAdmins(req, res) {
  try {
    const admins = await allQuery(`SELECT id, username, full_name, role, avatar, created_at FROM users ORDER BY id ASC`);
    return res.json({ admins });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách Quản trị viên' });
  }
}

async function createAdmin(req, res) {
  try {
    const { username, password, full_name } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ message: 'Vui lòng điền đủ Tên đăng nhập, Mật khẩu và Họ tên Admin' });
    }

    const existing = await getQuery(`SELECT id FROM users WHERE username = ?`, [username.trim()]);
    if (existing) {
      return res.status(400).json({ message: `Tên đăng nhập ${username} đã tồn tại` });
    }

    if (password.trim().length < 6) {
      return res.status(400).json({ message: 'Mật khẩu Quản trị viên phải có tối thiểu từ 6 ký tự' });
    }

    const hashPass = await bcrypt.hash(password.trim(), 10);
    await runQuery(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, 'ADMIN')
    `, [username.trim(), hashPass, full_name.trim()]);

    return res.json({ message: `Tạo tài khoản Quản trị viên ${full_name} thành công!` });
  } catch (err) {
    console.error('Create admin error:', err);
    return res.status(500).json({ message: 'Lỗi tạo tài khoản Admin' });
  }
}

async function updateAdminPassword(req, res) {
  try {
    const { id, new_password } = req.body;
    if (!id || !new_password) {
      return res.status(400).json({ message: 'Vui lòng cung cấp ID tài khoản và Mật khẩu mới' });
    }

    if (new_password.trim().length < 6) {
      return res.status(400).json({ message: 'Mật khẩu Quản trị viên mới phải có tối thiểu từ 6 ký tự' });
    }

    const hashPass = await bcrypt.hash(new_password.trim(), 10);
    await runQuery(`UPDATE users SET password_hash = ? WHERE id = ?`, [hashPass, id]);

    return res.json({ message: 'Đổi mật khẩu Quản trị viên thành công!' });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi đổi mật khẩu Admin' });
  }
}

async function deleteAdmin(req, res) {
  try {
    const { id } = req.params;
    if (req.user && req.user.id === parseInt(id)) {
      return res.status(400).json({ message: 'Bạn không thể tự xóa tài khoản Admin đang đăng nhập của chính mình' });
    }

    await runQuery(`DELETE FROM users WHERE id = ?`, [id]);
    return res.json({ message: 'Xóa tài khoản Quản trị viên thành công!' });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi xóa Admin' });
  }
}

// ==========================================
// 3. QUẢN LÝ & TẠO GIÁO VIÊN (BẢNG teachers)
// ==========================================
async function getTeachers(req, res) {
  try {
    const teachers = await allQuery(`
      SELECT t.id, t.username, t.full_name, t.phone, t.email, t.subject, t.created_at,
             GROUP_CONCAT(c.class_name, ', ') as assigned_classes
      FROM teachers t
      LEFT JOIN classes c ON t.id = c.teacher_id
      GROUP BY t.id
      ORDER BY t.id DESC
    `);
    return res.json({ teachers });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách giáo viên' });
  }
}

async function createTeacher(req, res) {
  try {
    const { username, password, full_name, phone, email, subject } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ message: 'Vui lòng nhập Tên tài khoản, Mật khẩu và Họ tên giáo viên' });
    }

    const trimmedUsername = username.trim();
    const existing = await getQuery(`SELECT id FROM teachers WHERE username = ?`, [trimmedUsername]);
    if (existing) {
      return res.status(400).json({ message: `Tài khoản giáo viên ${trimmedUsername} đã tồn tại trong hệ thống` });
    }

    if (password.trim().length < 6) {
      return res.status(400).json({ message: 'Mật khẩu Giáo viên phải có tối thiểu từ 6 ký tự' });
    }

    const hashPass = await bcrypt.hash(password.trim(), 10);
    await runQuery(`
      INSERT INTO teachers (username, password_hash, full_name, phone, email, subject)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [trimmedUsername, hashPass, full_name.trim(), phone || '', email || '', subject || 'Toán học']);

    return res.json({ message: `Tạo tài khoản Giáo viên ${full_name} (${trimmedUsername}) thành công!` });
  } catch (err) {
    console.error('Create teacher error:', err);
    return res.status(500).json({ message: 'Lỗi tạo giáo viên mới' });
  }
}

async function updateTeacher(req, res) {
  try {
    const { id, full_name, phone, email, subject } = req.body;
    if (!id || !full_name) {
      return res.status(400).json({ message: 'Vui lòng cung cấp ID và Họ tên giáo viên' });
    }

    await runQuery(`
      UPDATE teachers
      SET full_name = ?, phone = ?, email = ?, subject = ?
      WHERE id = ?
    `, [full_name.trim(), phone || '', email || '', subject || '', id]);

    return res.json({ message: `Cập nhật thông tin giáo viên ${full_name} thành công!` });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi cập nhật giáo viên' });
  }
}

// Đổi / Reset mật khẩu khi Giáo viên quên pass
async function resetTeacherPassword(req, res) {
  try {
    const { id, new_password } = req.body;
    if (!id) {
      return res.status(400).json({ message: 'Thiếu ID giáo viên cần đổi mật khẩu' });
    }

    const passToSet = new_password && new_password.trim() ? new_password.trim() : '123456';
    if (passToSet.length < 6) {
      return res.status(400).json({ message: 'Mật khẩu mới phải có tối thiểu từ 6 ký tự' });
    }
    const hashPass = await bcrypt.hash(passToSet, 10);

    await runQuery(`UPDATE teachers SET password_hash = ? WHERE id = ?`, [hashPass, id]);

    const teacher = await getQuery(`SELECT full_name, username FROM teachers WHERE id = ?`, [id]);
    return res.json({
      message: `Đã reset mật khẩu cho giáo viên ${teacher ? teacher.full_name : ''} thành "${passToSet}" thành công!`
    });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi reset mật khẩu giáo viên' });
  }
}

async function deleteTeacher(req, res) {
  try {
    const { id } = req.params;
    // Bỏ gán lớp chủ nhiệm trước khi xóa
    await runQuery(`UPDATE classes SET teacher_id = NULL WHERE teacher_id = ?`, [id]);
    await runQuery(`DELETE FROM teachers WHERE id = ?`, [id]);

    return res.json({ message: 'Đã xóa tài khoản giáo viên thành công!' });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi xóa giáo viên' });
  }
}

// ==========================================
// 4. QUẢN LÝ LỚP HỌC & PHÂN CÔNG CHỦ NHIỆM
// ==========================================
async function getClasses(req, res) {
  try {
    const classes = await allQuery(`
      SELECT c.*, t.full_name as teacher_name, t.phone as teacher_phone, COUNT(s.id) as student_count
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.id
      LEFT JOIN students s ON c.id = s.class_id
      GROUP BY c.id
      ORDER BY c.school_year DESC, c.class_name ASC
    `);
    return res.json({ classes });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách lớp học' });
  }
}

async function createClass(req, res) {
  try {
    const { class_name, school_year, teacher_id } = req.body;
    if (!class_name || !school_year) {
      return res.status(400).json({ message: 'Vui lòng nhập tên lớp và năm học' });
    }

    const tId = teacher_id ? parseInt(teacher_id) : null;

    const result = await runQuery(`
      INSERT INTO classes (class_name, school_year, teacher_id)
      VALUES (?, ?, ?)
    `, [class_name.trim(), school_year.trim(), tId]);

    const newClassId = result.lastID;

    // Tự động tạo 4 Tổ học tập cho lớp học mới
    await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [newClassId, 'Tổ 1']);
    await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [newClassId, 'Tổ 2']);
    await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [newClassId, 'Tổ 3']);
    await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [newClassId, 'Tổ 4']);

    return res.json({ message: `Tạo lớp ${class_name} (${school_year}) thành công (đã khởi tạo 4 tổ)!`, class_id: newClassId });
  } catch (err) {
    console.error('Create class error:', err);
    return res.status(500).json({ message: 'Lỗi tạo lớp học' });
  }
}

// Phân công GVCN cho lớp học
async function assignTeacherToClass(req, res) {
  try {
    const { class_id, teacher_id } = req.body;
    if (!class_id) {
      return res.status(400).json({ message: 'Thiếu class_id' });
    }

    const tId = teacher_id ? parseInt(teacher_id) : null;
    await runQuery(`UPDATE classes SET teacher_id = ? WHERE id = ?`, [tId, class_id]);

    const classObj = await getQuery(`
      SELECT c.class_name, t.full_name as teacher_name 
      FROM classes c 
      LEFT JOIN teachers t ON c.teacher_id = t.id 
      WHERE c.id = ?
    `, [class_id]);

    return res.json({
      message: `Phân công GVCN cho lớp ${classObj.class_name} thành công (${classObj.teacher_name || 'Chưa gán GVCN'})!`
    });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi phân công chủ nhiệm' });
  }
}

async function deleteClass(req, res) {
  try {
    const { id } = req.params;
    await runQuery(`DELETE FROM behavior_events WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)`, [id]);
    await runQuery(`DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)`, [id]);
    await runQuery(`DELETE FROM students WHERE class_id = ?`, [id]);
    await runQuery(`DELETE FROM groups WHERE class_id = ?`, [id]);
    await runQuery(`DELETE FROM classes WHERE id = ?`, [id]);

    return res.json({ message: 'Đã xóa lớp học thành công!' });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi xóa lớp học' });
  }
}

// ==========================================
// 5. QUẢN LÝ DANH SÁCH & NHẬP THÔNG TIN HỌC SINH
// ==========================================
async function getClassStudents(req, res) {
  try {
    const { class_id } = req.query;
    let sql = `
      SELECT s.*, g.group_name, c.class_name, c.school_year
      FROM students s
      LEFT JOIN groups g ON s.group_id = g.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (class_id) {
      sql += ` AND s.class_id = ?`;
      params.push(class_id);
    }
    sql += ` ORDER BY s.student_code ASC`;

    const students = await allQuery(sql, params);
    const groups = class_id ? await allQuery(`SELECT * FROM groups WHERE class_id = ? ORDER BY id ASC`, [class_id]) : [];

    return res.json({ students, groups });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách học sinh' });
  }
}

async function addStudent(req, res) {
  try {
    const { student_code, full_name, class_id, group_id, parent_phone, password } = req.body;
    if (!student_code || !full_name || !class_id) {
      return res.status(400).json({ message: 'Vui lòng điền Mã học sinh, Họ và tên và Chọn lớp học' });
    }

    const trimmedCode = student_code.trim();
    const existing = await getQuery(`SELECT id FROM students WHERE student_code = ?`, [trimmedCode]);
    if (existing) {
      return res.status(400).json({ message: `Mã học sinh ${trimmedCode} đã tồn tại trong hệ thống` });
    }

    let gId = group_id;
    if (!gId) {
      const firstGroup = await getQuery(`SELECT id FROM groups WHERE class_id = ? ORDER BY id ASC LIMIT 1`, [class_id]);
      if (firstGroup) gId = firstGroup.id;
    }

    const initialPass = password && password.trim() ? password.trim() : '123456';
    const hashPass = await bcrypt.hash(initialPass, 10);

    await runQuery(`
      INSERT INTO students (student_code, password_hash, full_name, class_id, group_id, base_score, parent_phone)
      VALUES (?, ?, ?, ?, ?, 100, ?)
    `, [trimmedCode, hashPass, full_name.trim(), class_id, gId, parent_phone || '']);

    return res.json({ message: `Thêm học sinh ${full_name} (${trimmedCode}) thành công! Mật khẩu khởi tạo: ${initialPass}` });
  } catch (err) {
    console.error('Add student error:', err);
    return res.status(500).json({ message: 'Lỗi thêm học sinh' });
  }
}

// Nhập hàng loạt học sinh (Batch Import)
async function importBatchStudents(req, res) {
  try {
    const { class_id, students_data } = req.body;
    if (!class_id || !Array.isArray(students_data) || students_data.length === 0) {
      return res.status(400).json({ message: 'Danh sách học sinh không hợp lệ hoặc rỗng' });
    }

    const groups = await allQuery(`SELECT id, group_name FROM groups WHERE class_id = ? ORDER BY id ASC`, [class_id]);
    const defaultGroupId = groups.length > 0 ? groups[0].id : 1;
    const defaultHashPass = await bcrypt.hash('123456', 10);

    let insertedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < students_data.length; i++) {
      const item = students_data[i];
      const code = item.student_code ? item.student_code.trim() : `HS${class_id}${String(i + 1).padStart(2, '0')}`;
      const name = item.full_name ? item.full_name.trim() : '';

      if (!name) {
        skippedCount++;
        continue;
      }

      // Check if student_code already exists
      const existing = await getQuery(`SELECT id FROM students WHERE student_code = ?`, [code]);
      if (existing) {
        skippedCount++;
        continue;
      }

      // Match group if provided by group_name or default to cycle through 4 groups
      let gId = defaultGroupId;
      if (groups.length > 0) {
        if (item.group_name) {
          const matchedG = groups.find(g => g.group_name.toLowerCase() === item.group_name.toLowerCase());
          if (matchedG) gId = matchedG.id;
        } else if (item.group_id) {
          gId = item.group_id;
        } else {
          gId = groups[i % groups.length].id;
        }
      }

      const pass = item.password ? await bcrypt.hash(item.password, 10) : defaultHashPass;

      await runQuery(`
        INSERT INTO students (student_code, password_hash, full_name, class_id, group_id, base_score, parent_phone)
        VALUES (?, ?, ?, ?, ?, 100, ?)
      `, [code, pass, name, class_id, gId, item.parent_phone || '']);

      insertedCount++;
    }

    return res.json({
      message: `Nhập danh sách thành công! Đã thêm ${insertedCount} học sinh (${skippedCount} bị bỏ qua do trùng mã hoặc thiếu tên).`
    });
  } catch (err) {
    console.error('Import batch error:', err);
    return res.status(500).json({ message: 'Lỗi khi nhập danh sách học sinh hàng loạt' });
  }
}

async function updateStudent(req, res) {
  try {
    const { id, student_code, full_name, group_id, parent_phone, base_score, password, class_role } = req.body;
    if (!id || !student_code || !full_name) {
      return res.status(400).json({ message: 'Vui lòng nhập đủ mã học sinh và họ tên' });
    }

    const currentStudent = await getQuery(`SELECT * FROM students WHERE id = ?`, [id]);
    if (!currentStudent) return res.status(404).json({ message: 'Không tìm thấy học sinh' });

    const trimmedCode = student_code.trim();
    const trimmedName = full_name.trim();

    // Check duplicate code
    const duplicate = await getQuery(`SELECT id FROM students WHERE student_code = ? AND id != ?`, [trimmedCode, id]);
    if (duplicate) {
      return res.status(400).json({ message: `Mã học sinh "${trimmedCode}" đã được sử dụng bởi học sinh khác` });
    }

    const bScore = base_score !== undefined && base_score !== null && !isNaN(base_score) ? parseInt(base_score) : 100;
    const cRole = class_role || currentStudent.class_role || 'HOC_SINH';

    if (cRole === 'LOP_TRUONG') {
      await runQuery(`UPDATE students SET class_role = 'HOC_SINH' WHERE class_id = ? AND class_role = 'LOP_TRUONG' AND id != ?`, [currentStudent.class_id, id]);
    }

    if (password && password.trim()) {
      if (password.trim().length < 6) {
        return res.status(400).json({ message: 'Mật khẩu học sinh phải có tối thiểu từ 6 ký tự' });
      }
      const hashPass = await bcrypt.hash(password.trim(), 10);
      await runQuery(`
        UPDATE students 
        SET student_code = ?, full_name = ?, group_id = ?, parent_phone = ?, base_score = ?, class_role = ?, password_hash = ?
        WHERE id = ?
      `, [trimmedCode, trimmedName, group_id, parent_phone || '', bScore, cRole, hashPass, id]);
    } else {
      await runQuery(`
        UPDATE students 
        SET student_code = ?, full_name = ?, group_id = ?, parent_phone = ?, base_score = ?, class_role = ?
        WHERE id = ?
      `, [trimmedCode, trimmedName, group_id, parent_phone || '', bScore, cRole, id]);
    }

    return res.json({ message: `Cập nhật thông tin học sinh ${trimmedName} thành công!` });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi cập nhật học sinh' });
  }
}

// Đổi / Reset mật khẩu mặc định khi học sinh quên pass
async function resetStudentPassword(req, res) {
  try {
    const { id, new_password } = req.body;
    if (!id) {
      return res.status(400).json({ message: 'Thiếu ID học sinh cần reset mật khẩu' });
    }

    const passToSet = new_password && new_password.trim() ? new_password.trim() : '123456';
    if (passToSet.length < 6) {
      return res.status(400).json({ message: 'Mật khẩu học sinh mới phải có tối thiểu từ 6 ký tự' });
    }
    const hashPass = await bcrypt.hash(passToSet, 10);

    await runQuery(`UPDATE students SET password_hash = ? WHERE id = ?`, [hashPass, id]);

    const student = await getQuery(`SELECT full_name, student_code FROM students WHERE id = ?`, [id]);
    return res.json({
      message: `Đã reset mật khẩu cho học sinh ${student ? student.full_name : ''} (${student ? student.student_code : ''}) về "${passToSet}" thành công!`
    });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi reset mật khẩu học sinh' });
  }
}

async function deleteStudent(req, res) {
  try {
    const { id } = req.params;
    const student = await getQuery(`SELECT full_name FROM students WHERE id = ?`, [id]);
    if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });

    await runQuery(`DELETE FROM behavior_events WHERE student_id = ?`, [id]);
    await runQuery(`DELETE FROM attendance WHERE student_id = ?`, [id]);
    await runQuery(`DELETE FROM students WHERE id = ?`, [id]);

    return res.json({ message: `Đã xóa học sinh ${student.full_name} thành công!` });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi xóa học sinh' });
  }
}

module.exports = {
  getAdminOverview,
  // Admins
  getAdmins,
  createAdmin,
  updateAdminPassword,
  deleteAdmin,
  // Teachers
  getTeachers,
  createTeacher,
  updateTeacher,
  resetTeacherPassword,
  deleteTeacher,
  // Classes
  getClasses,
  createClass,
  assignTeacherToClass,
  deleteClass,
  // Students
  getClassStudents,
  addStudent,
  importBatchStudents,
  updateStudent,
  resetStudentPassword,
  deleteStudent
};
