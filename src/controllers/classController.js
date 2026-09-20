const { runQuery, getQuery, allQuery } = require('../db/sqlite');
const bcrypt = require('bcryptjs');

// 1. Lấy chi tiết lớp học, danh sách tổ và phân công chấm chéo
async function getClassDetails(req, res) {
  try {
    const { class_id } = req.query;

    let classObj = null;
    if (class_id) {
      classObj = await getQuery(`
        SELECT c.*, t.full_name as teacher_name, t.phone as teacher_phone, t.email as teacher_email
        FROM classes c 
        LEFT JOIN teachers t ON c.teacher_id = t.id 
        WHERE c.id = ?
      `, [class_id]);
    } else {
      classObj = await getQuery(`
        SELECT c.*, t.full_name as teacher_name, t.phone as teacher_phone, t.email as teacher_email
        FROM classes c 
        LEFT JOIN teachers t ON c.teacher_id = t.id 
        ORDER BY c.school_year DESC, c.id ASC
        LIMIT 1
      `);
    }

    if (!classObj) return res.status(404).json({ message: 'Chưa có thông tin lớp học' });

    const groups = await allQuery(`
      SELECT g.*, s.full_name as leader_name, s.student_code as leader_code,
             COUNT(st.id) as student_count
      FROM groups g 
      LEFT JOIN students s ON g.leader_student_id = s.id 
      LEFT JOIN students st ON g.id = st.group_id
      WHERE g.class_id = ?
      GROUP BY g.id
      ORDER BY g.id ASC
    `, [classObj.id]);

    const students = await allQuery(`
      SELECT s.*, g.group_name 
      FROM students s 
      JOIN groups g ON s.group_id = g.id 
      WHERE s.class_id = ? 
      ORDER BY s.student_code ASC
    `, [classObj.id]);

    const assignments = await allQuery(`
      SELECT c.id, c.evaluator_student_id, c.evaluator_name, g.group_name as target_group_name, c.target_group_id
      FROM cross_eval_assignments c
      JOIN groups g ON c.target_group_id = g.id
      WHERE c.class_id = ?
    `, [classObj.id]);

    return res.json({
      class: classObj,
      groups,
      student_count: students.length,
      students,
      crossEvalAssignments: assignments
    });
  } catch (err) {
    console.error('Get class details error:', err);
    return res.status(500).json({ message: 'Lỗi lấy thông tin lớp học' });
  }
}

// 2. Tạo tổ mới (Dynamic Group Creation)
async function createGroup(req, res) {
  try {
    const { class_id, group_name } = req.body;
    if (!class_id || !group_name || !group_name.trim()) {
      return res.status(400).json({ message: 'Vui lòng cung cấp class_id và tên tổ' });
    }

    const trimmedName = group_name.trim();
    // Kiểm tra tên tổ trùng trong lớp
    const existing = await getQuery(`SELECT id FROM groups WHERE class_id = ? AND group_name = ?`, [class_id, trimmedName]);
    if (existing) {
      return res.status(400).json({ message: `Tổ "${trimmedName}" đã tồn tại trong lớp này` });
    }

    const result = await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [class_id, trimmedName]);
    return res.json({
      message: `Tạo "${trimmedName}" thành công!`,
      group_id: result.lastID,
      group_name: trimmedName
    });
  } catch (err) {
    console.error('Create group error:', err);
    return res.status(500).json({ message: 'Lỗi tạo tổ mới' });
  }
}

// 3. Đổi tên tổ
async function updateGroup(req, res) {
  try {
    const { id } = req.params;
    const { group_name } = req.body;
    if (!group_name || !group_name.trim()) {
      return res.status(400).json({ message: 'Vui lòng nhập tên tổ mới' });
    }

    const trimmedName = group_name.trim();
    const group = await getQuery(`SELECT * FROM groups WHERE id = ?`, [id]);
    if (!group) return res.status(404).json({ message: 'Không tìm thấy tổ cần sửa' });

    await runQuery(`UPDATE groups SET group_name = ? WHERE id = ?`, [trimmedName, id]);
    return res.json({ message: `Đã đổi tên tổ thành "${trimmedName}" thành công!` });
  } catch (err) {
    console.error('Update group error:', err);
    return res.status(500).json({ message: 'Lỗi đổi tên tổ' });
  }
}

// 4. Xóa tổ (kèm chuyển học sinh sang tổ khác nếu có)
async function deleteGroup(req, res) {
  try {
    const { id } = req.params;
    const fallback_group_id = req.body?.fallback_group_id || req.query?.fallback_group_id;

    const group = await getQuery(`SELECT * FROM groups WHERE id = ?`, [id]);
    if (!group) return res.status(404).json({ message: 'Không tìm thấy tổ cần xóa' });

    // Đếm số học sinh trong tổ
    const countRes = await getQuery(`SELECT COUNT(*) as count FROM students WHERE group_id = ?`, [id]);
    if (countRes.count > 0) {
      if (!fallback_group_id) {
        return res.status(400).json({
          message: `Tổ "${group.group_name}" đang có ${countRes.count} học sinh. Vui lòng chọn tổ tiếp nhận để chuyển học sinh trước khi xóa.`
        });
      }
      // Chuyển toàn bộ học sinh sang fallback_group_id
      await runQuery(`UPDATE students SET group_id = ? WHERE group_id = ?`, [fallback_group_id, id]);
    }

    // Xóa liên kết trong cross_eval_assignments
    await runQuery(`DELETE FROM cross_eval_assignments WHERE target_group_id = ?`, [id]);
    await runQuery(`DELETE FROM groups WHERE id = ?`, [id]);

    return res.json({ message: `Đã xóa "${group.group_name}" thành công!` });
  } catch (err) {
    console.error('Delete group error:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa tổ' });
  }
}

// 5. Luân chuyển 1 học sinh sang tổ khác (Single Student Transfer)
async function moveStudent(req, res) {
  try {
    const { student_id, new_group_id } = req.body;
    if (!student_id || !new_group_id) {
      return res.status(400).json({ message: 'Thiếu student_id hoặc new_group_id' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [student_id]);
    if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });

    const newGroup = await getQuery(`SELECT * FROM groups WHERE id = ?`, [new_group_id]);
    if (!newGroup) return res.status(404).json({ message: 'Không tìm thấy tổ tiếp nhận' });

    const oldGroupId = student.group_id;

    // Nếu học sinh này đang làm tổ trưởng của tổ cũ -> xóa chức vụ tổ trưởng của tổ cũ
    await runQuery(`UPDATE groups SET leader_student_id = NULL WHERE id = ? AND leader_student_id = ?`, [oldGroupId, student_id]);
    await runQuery(`DELETE FROM cross_eval_assignments WHERE evaluator_student_id = ?`, [student_id]);

    // Cập nhật tổ mới cho học sinh
    await runQuery(`UPDATE students SET group_id = ? WHERE id = ?`, [new_group_id, student_id]);

    return res.json({
      message: `Đã chuyển học sinh ${student.full_name} sang ${newGroup.group_name} thành công!`
    });
  } catch (err) {
    console.error('Move student error:', err);
    return res.status(500).json({ message: 'Lỗi luân chuyển học sinh' });
  }
}

// 6. Sắp xếp lại toàn bộ tổ (Auto Re-arrange / Balanced Partition)
async function rearrangeGroups(req, res) {
  try {
    const { class_id, method = 'ALPHABETICAL', custom_assignments } = req.body;
    if (!class_id) return res.status(400).json({ message: 'Thiếu class_id' });

    const groups = await allQuery(`SELECT id, group_name FROM groups WHERE class_id = ? ORDER BY id ASC`, [class_id]);
    if (groups.length === 0) {
      return res.status(400).json({ message: 'Lớp này chưa có tổ nào để sắp xếp' });
    }

    if (custom_assignments && Array.isArray(custom_assignments)) {
      // Phân tổ thủ công theo danh sách
      for (const item of custom_assignments) {
        await runQuery(`UPDATE students SET group_id = ? WHERE id = ? AND class_id = ?`, [item.group_id, item.student_id, class_id]);
      }
    } else {
      // Tự động chia đều theo Round-robin A-Z
      const students = await allQuery(`SELECT id FROM students WHERE class_id = ? ORDER BY student_code ASC`, [class_id]);
      for (let i = 0; i < students.length; i++) {
        const targetGroup = groups[i % groups.length];
        await runQuery(`UPDATE students SET group_id = ? WHERE id = ?`, [targetGroup.id, students[i].id]);
      }
    }

    // Reset lại leader_student_id không hợp lệ (nếu học sinh không còn ở tổ đó)
    for (const g of groups) {
      const leader = await getQuery(`SELECT leader_student_id FROM groups WHERE id = ?`, [g.id]);
      if (leader && leader.leader_student_id) {
        const check = await getQuery(`SELECT id FROM students WHERE id = ? AND group_id = ?`, [leader.leader_student_id, g.id]);
        if (!check) {
          await runQuery(`UPDATE groups SET leader_student_id = NULL WHERE id = ?`, [g.id]);
        }
      }
    }

    return res.json({ message: `Đã sắp xếp lại ${groups.length} tổ cho toàn bộ lớp học thành công!` });
  } catch (err) {
    console.error('Rearrange groups error:', err);
    return res.status(500).json({ message: 'Lỗi sắp xếp lại tổ' });
  }
}

// 7. Bổ nhiệm Tổ trưởng & Phân công chấm chéo
async function assignLeadersAndCrossEval(req, res) {
  try {
    const { class_id, assignments } = req.body;
    // assignments: [ { group_id, leader_student_id, target_group_id } ]
    if (!class_id || !Array.isArray(assignments)) {
      return res.status(400).json({ message: 'Dữ liệu phân công không hợp lệ' });
    }

    // Xóa phân công chấm chéo cũ của lớp
    await runQuery(`DELETE FROM cross_eval_assignments WHERE class_id = ?`, [class_id]);

    for (const item of assignments) {
      const { group_id, leader_student_id, target_group_id } = item;

      // 1. Cập nhật Tổ trưởng cho tổ
      if (group_id) {
        await runQuery(`UPDATE groups SET leader_student_id = ? WHERE id = ?`, [leader_student_id || null, group_id]);
      }

      // 2. Cập nhật phân công chấm chéo
      if (leader_student_id && target_group_id) {
        // Kiểm tra ràng buộc: Tổ trưởng không được tự chấm tổ của mình
        if (group_id === target_group_id) {
          return res.status(400).json({
            message: `Quy tắc vi phạm: Tổ trưởng không được tự chấm tổ của chính mình. Vui lòng phân công chấm chéo tổ khác.`
          });
        }

        const student = await getQuery(`SELECT s.full_name, g.group_name FROM students s JOIN groups g ON s.group_id = g.id WHERE s.id = ?`, [leader_student_id]);
        const evaluatorName = student ? `${student.full_name} (Tổ trưởng ${student.group_name})` : 'Tổ trưởng';

        await runQuery(`
          INSERT INTO cross_eval_assignments (class_id, evaluator_student_id, evaluator_name, target_group_id)
          VALUES (?, ?, ?, ?)
        `, [class_id, leader_student_id, evaluatorName, target_group_id]);
      }
    }

    return res.json({ message: 'Đã lưu danh sách Tổ trưởng và phân công chấm chéo thành công!' });
  } catch (err) {
    console.error('Assign leaders error:', err);
    return res.status(500).json({ message: 'Lỗi cập nhật phân công Tổ trưởng & chấm chéo' });
  }
}

// 8. Lấy danh sách tất cả lớp học
async function getAllClasses(req, res) {
  try {
    const classes = await allQuery(`
      SELECT c.*, t.full_name as teacher_name, COUNT(s.id) as student_count
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

// 9. Chỉnh sửa thông tin học sinh (cập nhật thông tin cá nhân, tổ, chức vụ ban cán sự, điểm gốc & mật khẩu)
async function updateStudent(req, res) {
  try {
    const studentId = req.params.id || req.body.id;
    const { student_code, full_name, group_id, parent_phone, base_score, password, class_role } = req.body;

    if (!studentId || !student_code || !full_name) {
      return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ Mã học sinh và Họ tên' });
    }

    const student = await getQuery(`SELECT * FROM students WHERE id = ?`, [studentId]);
    if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh cần sửa' });

    // Kiểm tra trùng lặp student_code với học sinh khác
    const duplicate = await getQuery(`SELECT id FROM students WHERE student_code = ? AND id != ?`, [student_code.trim(), studentId]);
    if (duplicate) {
      return res.status(400).json({ message: `Mã học sinh "${student_code.trim()}" đã được sử dụng bởi học sinh khác` });
    }

    const trimmedCode = student_code.trim();
    const trimmedName = full_name.trim();
    const bScore = base_score !== undefined && base_score !== null && !isNaN(base_score) ? parseInt(base_score) : (student.base_score || 100);
    const gId = group_id ? parseInt(group_id) : student.group_id;
    const cRole = class_role || student.class_role || 'HOC_SINH';

    // Nếu bổ nhiệm Lớp Trưởng thì chuyển Lớp trưởng cũ cùng lớp về Học sinh
    if (cRole === 'LOP_TRUONG') {
      await runQuery(`UPDATE students SET class_role = 'HOC_SINH' WHERE class_id = ? AND class_role = 'LOP_TRUONG' AND id != ?`, [student.class_id, studentId]);
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
      `, [trimmedCode, trimmedName, gId, parent_phone || '', bScore, cRole, hashPass, studentId]);
    } else {
      await runQuery(`
        UPDATE students 
        SET student_code = ?, full_name = ?, group_id = ?, parent_phone = ?, base_score = ?, class_role = ?
        WHERE id = ?
      `, [trimmedCode, trimmedName, gId, parent_phone || '', bScore, cRole, studentId]);
    }

    return res.json({ message: `Cập nhật thông tin học sinh ${trimmedName} thành công!` });
  } catch (err) {
    console.error('Update student error:', err);
    return res.status(500).json({ message: 'Lỗi cập nhật học sinh' });
  }
}

module.exports = {
  getClassDetails,
  createGroup,
  updateGroup,
  deleteGroup,
  moveStudent,
  rearrangeGroups,
  assignLeadersAndCrossEval,
  getAllClasses,
  updateStudent
};
