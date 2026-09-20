const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getQuery, allQuery } = require('../db/sqlite');
const { JWT_SECRET } = require('../middlewares/authMiddleware');

async function login(req, res) {
  try {
    const { portal, username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập tên đăng nhập / mã học sinh và mật khẩu' });
    }

    const trimmedUsername = username.trim();

    // 1. CỔNG ADMIN (Bảng users)
    if (portal === 'admin') {
      const user = await getQuery(`SELECT * FROM users WHERE username = ?`, [trimmedUsername]);
      if (!user) {
        return res.status(400).json({ message: 'Tài khoản Quản trị viên không tồn tại' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(400).json({ message: 'Mật khẩu Quản trị viên không chính xác' });
      }

      const payload = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: 'ADMIN',
        portal: 'admin',
        avatar: user.avatar
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
      return res.json({
        message: 'Đăng nhập Quản trị viên thành công',
        token,
        user: payload,
        portal: 'admin'
      });
    }

    // 2. CỔNG GIÁO VIÊN CHỦ NHIỆM (Bảng teachers)
    if (portal === 'teacher') {
      const teacher = await getQuery(`SELECT * FROM teachers WHERE username = ?`, [trimmedUsername]);
      if (!teacher) {
        return res.status(400).json({ message: 'Tài khoản Giáo viên không tồn tại' });
      }

      const match = await bcrypt.compare(password, teacher.password_hash);
      if (!match) {
        return res.status(400).json({ message: 'Mật khẩu Giáo viên không chính xác' });
      }

      // Lấy danh sách các lớp giáo viên này đang chủ nhiệm
      const classes = await allQuery(`
        SELECT c.*, COUNT(s.id) as student_count
        FROM classes c
        LEFT JOIN students s ON c.id = s.class_id
        WHERE c.teacher_id = ?
        GROUP BY c.id
        ORDER BY c.school_year DESC, c.class_name ASC
      `, [teacher.id]);

      const payload = {
        id: teacher.id,
        username: teacher.username,
        full_name: teacher.full_name,
        phone: teacher.phone,
        email: teacher.email,
        subject: teacher.subject,
        role: 'GVCN',
        portal: 'teacher',
        defaultClassId: classes.length > 0 ? classes[0].id : null
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
      return res.json({
        message: 'Đăng nhập Cổng Giáo viên thành công',
        token,
        user: payload,
        classes,
        portal: 'teacher'
      });
    }

    // 3. CỔNG HỌC SINH (Bảng students)
    if (portal === 'student') {
      const student = await getQuery(`
        SELECT s.*, c.class_name, c.school_year, g.group_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN groups g ON s.group_id = g.id
        WHERE s.student_code = ?
      `, [trimmedUsername]);

      if (!student) {
        return res.status(400).json({ message: `Mã học sinh ${trimmedUsername} không tồn tại trong hệ thống` });
      }

      const match = await bcrypt.compare(password, student.password_hash);
      if (!match) {
        return res.status(400).json({ message: 'Mật khẩu học sinh không chính xác' });
      }

      // Kiểm tra chức vụ Ban cán sự lớp & Tổ trưởng
      const cRole = student.class_role || 'HOC_SINH';
      const isMonitor = (cRole === 'LOP_TRUONG' || cRole === 'LOP_PHO');

      const leaderGroup = await getQuery(`SELECT id, group_name FROM groups WHERE leader_student_id = ?`, [student.id]);
      let isLeader = false;
      let userRole = cRole === 'LOP_TRUONG' ? 'LOP_TRUONG' : cRole === 'LOP_PHO' ? 'LOP_PHO' : 'HOC_SINH';
      let leaderGroupId = null;
      let leaderGroupName = null;
      let assignedTargetGroupId = null;
      let assignedTargetGroupName = null;

      if (leaderGroup) {
        isLeader = true;
        if (!isMonitor) {
          userRole = 'TO_TRUONG';
        }
        leaderGroupId = leaderGroup.id;
        leaderGroupName = leaderGroup.group_name;

        const crossEval = await getQuery(`
          SELECT cea.target_group_id, g.group_name as target_group_name
          FROM cross_eval_assignments cea
          JOIN groups g ON cea.target_group_id = g.id
          WHERE cea.evaluator_student_id = ?
        `, [student.id]);

        if (crossEval) {
          assignedTargetGroupId = crossEval.target_group_id;
          assignedTargetGroupName = crossEval.target_group_name;
        }
      }

      const payload = {
        id: student.id,
        username: student.student_code,
        student_code: student.student_code,
        full_name: student.full_name,
        class_id: student.class_id,
        class_name: student.class_name,
        school_year: student.school_year,
        group_id: student.group_id,
        group_name: student.group_name,
        base_score: student.base_score,
        class_role: cRole,
        is_monitor: isMonitor,
        role: userRole,
        is_group_leader: isLeader,
        leader_group_id: leaderGroupId,
        leader_group_name: leaderGroupName,
        assigned_target_group_id: assignedTargetGroupId,
        assigned_target_group_name: assignedTargetGroupName,
        portal: 'student'
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
      return res.json({
        message: 'Đăng nhập Cổng Học sinh thành công',
        token,
        user: payload,
        portal: 'student'
      });
    }

    // Tự động nhận diện (nếu không truyền portal)
    // Thử bảng users (Admin)
    const adminUser = await getQuery(`SELECT * FROM users WHERE username = ?`, [trimmedUsername]);
    if (adminUser) {
      const match = await bcrypt.compare(password, adminUser.password_hash);
      if (match) {
        const payload = { id: adminUser.id, username: adminUser.username, full_name: adminUser.full_name, role: 'ADMIN', portal: 'admin' };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ message: 'Đăng nhập thành công', token, user: payload, portal: 'admin' });
      }
    }

    // Thử bảng teachers (Giáo viên)
    const teacherUser = await getQuery(`SELECT * FROM teachers WHERE username = ?`, [trimmedUsername]);
    if (teacherUser) {
      const match = await bcrypt.compare(password, teacherUser.password_hash);
      if (match) {
        const payload = { id: teacherUser.id, username: teacherUser.username, full_name: teacherUser.full_name, role: 'GVCN', portal: 'teacher' };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ message: 'Đăng nhập thành công', token, user: payload, portal: 'teacher' });
      }
    }

    // Thử bảng students (Học sinh)
    const studentUser = await getQuery(`SELECT s.*, c.class_name, g.group_name FROM students s LEFT JOIN classes c ON s.class_id = c.id LEFT JOIN groups g ON s.group_id = g.id WHERE s.student_code = ?`, [trimmedUsername]);
    if (studentUser) {
      const match = await bcrypt.compare(password, studentUser.password_hash);
      if (match) {
        const cRole = studentUser.class_role || 'HOC_SINH';
        const isMonitor = (cRole === 'LOP_TRUONG' || cRole === 'LOP_PHO');

        const leaderGroup = await getQuery(`SELECT id, group_name FROM groups WHERE leader_student_id = ?`, [studentUser.id]);
        let isLeader = false;
        let userRole = cRole === 'LOP_TRUONG' ? 'LOP_TRUONG' : cRole === 'LOP_PHO' ? 'LOP_PHO' : 'HOC_SINH';
        let leaderGroupId = null;
        let leaderGroupName = null;
        let assignedTargetGroupId = null;
        let assignedTargetGroupName = null;

        if (leaderGroup) {
          isLeader = true;
          if (!isMonitor) {
            userRole = 'TO_TRUONG';
          }
          leaderGroupId = leaderGroup.id;
          leaderGroupName = leaderGroup.group_name;

          const crossEval = await getQuery(`
            SELECT cea.target_group_id, g.group_name as target_group_name
            FROM cross_eval_assignments cea
            JOIN groups g ON cea.target_group_id = g.id
            WHERE cea.evaluator_student_id = ?
          `, [studentUser.id]);

          if (crossEval) {
            assignedTargetGroupId = crossEval.target_group_id;
            assignedTargetGroupName = crossEval.target_group_name;
          }
        }

        const payload = {
          id: studentUser.id,
          username: studentUser.student_code,
          student_code: studentUser.student_code,
          full_name: studentUser.full_name,
          class_id: studentUser.class_id,
          class_name: studentUser.class_name,
          group_id: studentUser.group_id,
          group_name: studentUser.group_name,
          class_role: cRole,
          is_monitor: isMonitor,
          role: userRole,
          is_group_leader: isLeader,
          leader_group_id: leaderGroupId,
          leader_group_name: leaderGroupName,
          assigned_target_group_id: assignedTargetGroupId,
          assigned_target_group_name: assignedTargetGroupName,
          portal: 'student'
        };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ message: 'Đăng nhập thành công', token, user: payload, portal: 'student' });
      }
    }

    return res.status(400).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ khi đăng nhập' });
  }
}

async function getMe(req, res) {
  try {
    const { portal, role, id } = req.user;

    if (portal === 'admin' || role === 'ADMIN') {
      const user = await getQuery(`SELECT id, username, full_name, role, avatar, created_at FROM users WHERE id = ?`, [id]);
      if (!user) return res.status(404).json({ message: 'Không tìm thấy thông tin Admin' });
      return res.json({ user: { ...user, portal: 'admin' } });
    }

    if (portal === 'teacher' || role === 'GVCN') {
      const teacher = await getQuery(`SELECT id, username, full_name, phone, email, subject, avatar, created_at FROM teachers WHERE id = ?`, [id]);
      if (!teacher) return res.status(404).json({ message: 'Không tìm thấy thông tin Giáo viên' });

      // Lấy các lớp GV đang phụ trách
      const classes = await allQuery(`
        SELECT c.*, COUNT(s.id) as student_count
        FROM classes c
        LEFT JOIN students s ON c.id = s.class_id
        WHERE c.teacher_id = ?
        GROUP BY c.id
        ORDER BY c.school_year DESC, c.class_name ASC
      `, [teacher.id]);

      return res.json({ user: { ...teacher, role: 'GVCN', portal: 'teacher' }, classes });
    }

    if (portal === 'student' || role === 'HOC_SINH' || role === 'TO_TRUONG' || role === 'LOP_TRUONG' || role === 'LOP_PHO') {
      const student = await getQuery(`
        SELECT s.id, s.student_code, s.full_name, s.class_id, s.group_id, s.base_score, s.parent_phone, s.class_role,
               c.class_name, c.school_year, g.group_name, t.full_name as homeroom_teacher_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN teachers t ON c.teacher_id = t.id
        LEFT JOIN groups g ON s.group_id = g.id
        WHERE s.id = ?
      `, [id]);

      if (!student) return res.status(404).json({ message: 'Không tìm thấy thông tin Học sinh' });

      const cRole = student.class_role || 'HOC_SINH';
      const isMonitor = (cRole === 'LOP_TRUONG' || cRole === 'LOP_PHO');

      // Kiểm tra Tổ trưởng
      const leaderGroup = await getQuery(`SELECT id, group_name FROM groups WHERE leader_student_id = ?`, [student.id]);
      let isLeader = false;
      let userRole = cRole === 'LOP_TRUONG' ? 'LOP_TRUONG' : cRole === 'LOP_PHO' ? 'LOP_PHO' : 'HOC_SINH';
      let leaderGroupId = null;
      let leaderGroupName = null;
      let assignedTargetGroupId = null;
      let assignedTargetGroupName = null;

      if (leaderGroup) {
        isLeader = true;
        if (!isMonitor) {
          userRole = 'TO_TRUONG';
        }
        leaderGroupId = leaderGroup.id;
        leaderGroupName = leaderGroup.group_name;

        const crossEval = await getQuery(`
          SELECT cea.target_group_id, g.group_name as target_group_name
          FROM cross_eval_assignments cea
          JOIN groups g ON cea.target_group_id = g.id
          WHERE cea.evaluator_student_id = ?
        `, [student.id]);

        if (crossEval) {
          assignedTargetGroupId = crossEval.target_group_id;
          assignedTargetGroupName = crossEval.target_group_name;
        }
      }

      return res.json({
        user: {
          ...student,
          class_role: cRole,
          is_monitor: isMonitor,
          role: userRole,
          is_group_leader: isLeader,
          leader_group_id: leaderGroupId,
          leader_group_name: leaderGroupName,
          assigned_target_group_id: assignedTargetGroupId,
          assigned_target_group_name: assignedTargetGroupName,
          portal: 'student'
        }
      });
    }

    return res.status(400).json({ message: 'Không xác định được loại tài khoản' });
  } catch (err) {
    console.error('GetMe error:', err);
    return res.status(500).json({ message: 'Lỗi lấy thông tin tài khoản' });
  }
}

// Lấy danh sách các lớp cho GVCN (kèm các lớp năm trước)
async function getTeacherClasses(req, res) {
  try {
    const teacherId = req.user.id;
    // Lấy tất cả các lớp của GVCN hoặc toàn bộ lớp trong trường nếu là Admin
    let classes = [];
    if (req.user.role === 'ADMIN') {
      classes = await allQuery(`
        SELECT c.*, t.full_name as teacher_name, COUNT(s.id) as student_count
        FROM classes c
        LEFT JOIN teachers t ON c.teacher_id = t.id
        LEFT JOIN students s ON c.id = s.class_id
        GROUP BY c.id
        ORDER BY c.school_year DESC, c.class_name ASC
      `);
    } else {
      classes = await allQuery(`
        SELECT c.*, t.full_name as teacher_name, COUNT(s.id) as student_count
        FROM classes c
        LEFT JOIN teachers t ON c.teacher_id = t.id
        LEFT JOIN students s ON c.id = s.class_id
        WHERE c.teacher_id = ?
        GROUP BY c.id
        ORDER BY c.school_year DESC, c.class_name ASC
      `, [teacherId]);

      // Nếu GV chưa được gán lớp nào, cho phép load các lớp công khai để xem
      if (classes.length === 0) {
        classes = await allQuery(`
          SELECT c.*, t.full_name as teacher_name, COUNT(s.id) as student_count
          FROM classes c
          LEFT JOIN teachers t ON c.teacher_id = t.id
          LEFT JOIN students s ON c.id = s.class_id
          GROUP BY c.id
          ORDER BY c.school_year DESC, c.class_name ASC
        `);
      }
    }

    return res.json({ classes });
  } catch (err) {
    console.error('Get teacher classes error:', err);
    return res.status(500).json({ message: 'Lỗi lấy danh sách lớp học' });
  }
}

module.exports = {
  login,
  getMe,
  getTeacherClasses
};
