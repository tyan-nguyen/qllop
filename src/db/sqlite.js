const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Hỗ trợ cấu hình đường dẫn SQLite từ biến môi trường DB_PATH hoặc SQLITE_DB_PATH
const rawDbPath = process.env.DB_PATH || process.env.SQLITE_DB_PATH;
const dbPath = rawDbPath
  ? (path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(process.cwd(), rawDbPath))
  : path.resolve(__dirname, '../../database.sqlite');

// Tự động tạo thư mục chứa file CSDL nếu chưa tồn tại
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDatabase() {
  db.serialize(async () => {
    // 1. Users (Cổng Admin)
    db.run(`
      CREATE TABLE IF NOT EXISTS users_temp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'ADMIN',
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check if users table needs migration
    db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`, (err, row) => {
      if (row && row.sql.includes('CHECK')) {
        db.serialize(() => {
          db.run(`INSERT OR IGNORE INTO users_temp (id, username, password_hash, full_name, role) SELECT id, username, password_hash, full_name, 'ADMIN' FROM users`);
          db.run(`DROP TABLE users`);
          db.run(`ALTER TABLE users_temp RENAME TO users`);
        });
      } else if (!row) {
        db.run(`ALTER TABLE users_temp RENAME TO users`);
      } else {
        db.run(`DROP TABLE IF EXISTS users_temp`);
      }
    });

    // 2. Teachers (Cổng Giáo viên chủ nhiệm)
    db.run(`
      CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        subject TEXT,
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Classes (Lớp học)
    db.run(`
      CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_name TEXT NOT NULL,
        school_year TEXT NOT NULL,
        teacher_id INTEGER,
        FOREIGN KEY(teacher_id) REFERENCES teachers(id)
      )
    `);

    // 4. Groups (Tổ học tập)
    db.run(`
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        group_name TEXT NOT NULL,
        leader_student_id INTEGER,
        FOREIGN KEY(class_id) REFERENCES classes(id)
      )
    `);

    // 5. Students (Cổng Học sinh)
    db.run(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_code TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        class_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        base_score INTEGER DEFAULT 100,
        parent_phone TEXT,
        class_role TEXT DEFAULT 'HOC_SINH',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(class_id) REFERENCES classes(id),
        FOREIGN KEY(group_id) REFERENCES groups(id)
      )
    `);

    // 6. Event Types (Cấu hình sự kiện điểm nề nếp)
    db.run(`
      CREATE TABLE IF NOT EXISTS event_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT CHECK(category IN ('PENALTY', 'BONUS')),
        default_points INTEGER NOT NULL,
        icon TEXT
      )
    `);

    // 7. Behavior Events (Sự kiện vi phạm / việc tốt)
    db.run(`
      CREATE TABLE IF NOT EXISTS behavior_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        event_type_id INTEGER NOT NULL,
        points_applied INTEGER NOT NULL,
        note TEXT,
        event_date TEXT NOT NULL,
        created_by_teacher_id INTEGER,
        created_by_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id),
        FOREIGN KEY(event_type_id) REFERENCES event_types(id)
      )
    `);

    // 8. Attendance (Điểm danh hằng ngày)
    db.run(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        status TEXT CHECK(status IN ('PRESENT', 'EXCUSED', 'UNEXCUSED', 'LATE', 'EARLY_LEAVE')),
        note TEXT,
        created_by_teacher_id INTEGER,
        UNIQUE(student_id, date),
        FOREIGN KEY(student_id) REFERENCES students(id)
      )
    `);

    // 9. Specialized Logs (Nhật ký hoạt động chuyên môn GV)
    db.run(`
      CREATE TABLE IF NOT EXISTS specialized_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        lesson_period INTEGER,
        class_name TEXT,
        tech_used TEXT,
        evidence TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 10. Cross Eval Assignments (Phân công chấm chéo giữa các tổ)
    db.run(`
      CREATE TABLE IF NOT EXISTS cross_eval_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        evaluator_student_id INTEGER,
        evaluator_name TEXT,
        target_group_id INTEGER NOT NULL,
        FOREIGN KEY(class_id) REFERENCES classes(id),
        FOREIGN KEY(target_group_id) REFERENCES groups(id)
      )
    `);

    // Migration helper: Ensure missing columns exist in upgraded database
    try {
      db.run(`ALTER TABLE students ADD COLUMN password_hash TEXT DEFAULT ''`, () => {});
      db.run(`ALTER TABLE students ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, () => {});
      db.run(`ALTER TABLE students ADD COLUMN class_role TEXT DEFAULT 'HOC_SINH'`, () => {});
      db.run(`ALTER TABLE groups ADD COLUMN leader_student_id INTEGER`, () => {});
      db.run(`ALTER TABLE specialized_logs ADD COLUMN teacher_id INTEGER`, () => {});
      db.run(`ALTER TABLE classes ADD COLUMN teacher_id INTEGER`, () => {});
      db.run(`ALTER TABLE behavior_events ADD COLUMN created_by_teacher_id INTEGER`, () => {});
      db.run(`ALTER TABLE behavior_events ADD COLUMN created_by_name TEXT`, () => {});
      db.run(`ALTER TABLE attendance ADD COLUMN created_by_teacher_id INTEGER`, () => {});
      
      // Update legacy text icon names to vibrant emojis
      db.run(`UPDATE event_types SET icon = '📖' WHERE icon = 'book-open'`);
      db.run(`UPDATE event_types SET icon = '📝' WHERE icon = 'edit-3'`);
      db.run(`UPDATE event_types SET icon = '⏰' WHERE icon = 'clock'`);
      db.run(`UPDATE event_types SET icon = '💬' WHERE icon = 'message-square'`);
      db.run(`UPDATE event_types SET icon = '📱' WHERE icon = 'smartphone'`);
      db.run(`UPDATE event_types SET icon = '🚫' WHERE icon = 'user-x'`);
      db.run(`UPDATE event_types SET icon = '👔' WHERE icon = 'shield-alert'`);
      db.run(`UPDATE event_types SET icon = '❤️' WHERE icon = 'heart'`);
      db.run(`UPDATE event_types SET icon = '🏅' WHERE icon = 'award'`);
      db.run(`UPDATE event_types SET icon = '👍' WHERE icon = 'thumbs-up'`);
      db.run(`UPDATE event_types SET icon = '⭐' WHERE icon = 'star'`);
      db.run(`UPDATE event_types SET icon = '😊' WHERE icon = 'smile'`);
      db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='attendance'`, (err, row) => {
        if (row && row.sql.includes('created_by_user_id')) {
          db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS attendance_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              student_id INTEGER NOT NULL,
              date TEXT NOT NULL,
              status TEXT CHECK(status IN ('PRESENT', 'EXCUSED', 'UNEXCUSED', 'LATE', 'EARLY_LEAVE')),
              note TEXT,
              created_by_teacher_id INTEGER,
              UNIQUE(student_id, date),
              FOREIGN KEY(student_id) REFERENCES students(id)
            )`);
            db.run(`INSERT OR IGNORE INTO attendance_new (id, student_id, date, status, note, created_by_teacher_id)
                    SELECT id, student_id, date, status, note, 1 FROM attendance`);
            db.run(`DROP TABLE attendance`);
            db.run(`ALTER TABLE attendance_new RENAME TO attendance`);
          });
        }
      });

      db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='cross_eval_assignments'`, (err, row) => {
        if (row && (!row.sql.includes('evaluator_name') || !row.sql.includes('evaluator_student_id') || !row.sql.includes('class_id'))) {
          db.serialize(() => {
            db.run(`DROP TABLE cross_eval_assignments`);
            db.run(`
              CREATE TABLE cross_eval_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id INTEGER NOT NULL,
                evaluator_student_id INTEGER,
                evaluator_name TEXT,
                target_group_id INTEGER NOT NULL,
                FOREIGN KEY(class_id) REFERENCES classes(id),
                FOREIGN KEY(target_group_id) REFERENCES groups(id)
              )
            `);
          });
        }
      });
    } catch (e) {}

    // Seed Data
    setTimeout(async () => {
      await seedDatabase();
    }, 500);
  });
}

async function seedDatabase() {
  const hashPass = await bcrypt.hash('123456', 10);

  // 1. Seed Admin Users (Bảng users)
  const adminUser = await getQuery(`SELECT id FROM users WHERE username = 'admin'`);
  if (!adminUser) {
    console.log('Seeding initial Admin user...');
    await runQuery(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)`, [
      'admin', hashPass, 'Quản trị viên Hệ thống (Admin)', 'ADMIN'
    ]);
  }

  // 2. Seed Teachers (Bảng teachers)
  const teacherCount = await getQuery(`SELECT COUNT(*) as count FROM teachers`);
  if (teacherCount.count === 0) {
    console.log('Seeding initial Teachers...');
    await runQuery(`INSERT INTO teachers (username, password_hash, full_name, phone, email, subject) VALUES (?, ?, ?, ?, ?, ?)`, [
      'gvcn', hashPass, 'Cô Nguyễn Thị Mai', '0912345678', 'mai.nguyen@thpt.edu.vn', 'Toán học'
    ]);
    await runQuery(`INSERT INTO teachers (username, password_hash, full_name, phone, email, subject) VALUES (?, ?, ?, ?, ?, ?)`, [
      'gv_toan', hashPass, 'Thầy Lê Văn Hùng', '0923456789', 'hung.le@thpt.edu.vn', 'Vật lý'
    ]);
    await runQuery(`INSERT INTO teachers (username, password_hash, full_name, phone, email, subject) VALUES (?, ?, ?, ?, ?, ?)`, [
      'gv_van', hashPass, 'Cô Trần Thị Lan', '0934567890', 'lan.tran@thpt.edu.vn', 'Ngữ văn'
    ]);
  }

  // 3. Seed Classes (Bảng classes)
  const classCount = await getQuery(`SELECT COUNT(*) as count FROM classes`);
  if (classCount.count === 0) {
    console.log('Seeding initial Classes...');
    const gvcn = await getQuery(`SELECT id FROM teachers WHERE username = 'gvcn'`);
    const gvToan = await getQuery(`SELECT id FROM teachers WHERE username = 'gv_toan'`);

    // Class 1: 10B2 (2025-2026) - GVCN Cô Mai
    await runQuery(`INSERT INTO classes (class_name, school_year, teacher_id) VALUES (?, ?, ?)`, [
      '10B2', '2025-2026', gvcn ? gvcn.id : 1
    ]);
    // Class 2: 11A1 (2025-2026) - GVCN Thầy Hùng
    await runQuery(`INSERT INTO classes (class_name, school_year, teacher_id) VALUES (?, ?, ?)`, [
      '11A1', '2025-2026', gvToan ? gvToan.id : 2
    ]);
    // Class 3: 10A1 (2024-2025) - Năm học trước của Cô Mai
    await runQuery(`INSERT INTO classes (class_name, school_year, teacher_id) VALUES (?, ?, ?)`, [
      '10A1', '2024-2025', gvcn ? gvcn.id : 1
    ]);
  }

  // 4. Seed Groups for Classes
  const groupCount = await getQuery(`SELECT COUNT(*) as count FROM groups`);
  if (groupCount.count === 0) {
    console.log('Seeding initial Groups for classes...');
    const classes = await allQuery(`SELECT id FROM classes`);
    for (const c of classes) {
      await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [c.id, 'Tổ 1']);
      await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [c.id, 'Tổ 2']);
      await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [c.id, 'Tổ 3']);
      await runQuery(`INSERT INTO groups (class_id, group_name) VALUES (?, ?)`, [c.id, 'Tổ 4']);
    }
  }

  // 5. Seed Event Types
  const eventTypeCount = await getQuery(`SELECT COUNT(*) as count FROM event_types`);
  if (eventTypeCount.count === 0) {
    console.log('Seeding event types...');
    const eventTypes = [
      { name: 'Không học bài', category: 'PENALTY', points: -2, icon: 'book-open' },
      { name: 'Không làm bài tập', category: 'PENALTY', points: -3, icon: 'edit-3' },
      { name: 'Đi trễ', category: 'PENALTY', points: -1, icon: 'clock' },
      { name: 'Nói chuyện trong giờ', category: 'PENALTY', points: -2, icon: 'message-square' },
      { name: 'Sử dụng điện thoại trái phép', category: 'PENALTY', points: -5, icon: 'smartphone' },
      { name: 'Nghỉ không phép', category: 'PENALTY', points: -5, icon: 'user-x' },
      { name: 'Đồng phục không đúng quy định', category: 'PENALTY', points: -2, icon: 'shield-alert' },
      { name: 'Giúp bạn', category: 'BONUS', points: 2, icon: 'heart' },
      { name: 'Tham gia phong trào tích cực', category: 'BONUS', points: 3, icon: 'award' },
      { name: 'Phát biểu xây dựng bài', category: 'BONUS', points: 1, icon: 'thumbs-up' },
      { name: 'Đạt điểm 10 kiểm tra', category: 'BONUS', points: 5, icon: 'star' },
      { name: 'Việc tốt nhặt được của rơi', category: 'BONUS', points: 5, icon: 'smile' }
    ];

    for (const et of eventTypes) {
      await runQuery(`INSERT INTO event_types (name, category, default_points, icon) VALUES (?, ?, ?, ?)`, [
        et.name, et.category, et.points, et.icon
      ]);
    }
  }

  // 6. Seed Students (Bảng students)
  const studentCount = await getQuery(`SELECT COUNT(*) as count FROM students`);
  if (studentCount.count === 0) {
    console.log('Seeding students for class 10B2...');
    const class10B2 = await getQuery(`SELECT id FROM classes WHERE class_name = '10B2'`);
    const cId = class10B2 ? class10B2.id : 1;
    const groups = await allQuery(`SELECT id FROM groups WHERE class_id = ? ORDER BY id ASC`, [cId]);
    const groupIds = groups.map(g => g.id);

    const hoList = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ'];
    const demList = ['Văn', 'Thị', 'Minh', 'Đức', 'Quang', 'Ngọc', 'Thanh', 'Anh', 'Gia', 'Hải'];
    const tenList = ['Anh', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hùng', 'Khánh', 'Lâm', 'Nam', 'Phương', 'Quân', 'Sơn', 'Trang', 'Tú', 'Vinh', 'Yến'];

    for (let i = 1; i <= 44; i++) {
      const code = `HS10B2${i.toString().padStart(2, '0')}`;
      let fullName = '';
      if (i === 1) {
        fullName = 'Nguyễn Văn A';
      } else {
        const h = hoList[i % hoList.length];
        const d = demList[i % demList.length];
        const t = tenList[i % tenList.length];
        fullName = `${h} ${d} ${t}`;
      }
      const gId = groupIds.length > 0 ? groupIds[(i - 1) % groupIds.length] : 1;

      await runQuery(
        `INSERT INTO students (student_code, password_hash, full_name, class_id, group_id, base_score, parent_phone) VALUES (?, ?, ?, ?, ?, 100, ?)`,
        [code, hashPass, fullName, cId, gId, `0987${(100000 + i).toString()}`]
      );
    }

    // Seed sample group leaders and cross eval assignments
    if (groups.length >= 4) {
      const s1 = await getQuery(`SELECT id, full_name FROM students WHERE class_id = ? AND group_id = ? LIMIT 1`, [cId, groups[0].id]);
      const s2 = await getQuery(`SELECT id, full_name FROM students WHERE class_id = ? AND group_id = ? LIMIT 1`, [cId, groups[1].id]);
      const s3 = await getQuery(`SELECT id, full_name FROM students WHERE class_id = ? AND group_id = ? LIMIT 1`, [cId, groups[2].id]);
      const s4 = await getQuery(`SELECT id, full_name FROM students WHERE class_id = ? AND group_id = ? LIMIT 1`, [cId, groups[3].id]);

      if (s1) await runQuery(`UPDATE groups SET leader_student_id = ? WHERE id = ?`, [s1.id, groups[0].id]);
      if (s2) await runQuery(`UPDATE groups SET leader_student_id = ? WHERE id = ?`, [s2.id, groups[1].id]);
      if (s3) await runQuery(`UPDATE groups SET leader_student_id = ? WHERE id = ?`, [s3.id, groups[2].id]);
      if (s4) await runQuery(`UPDATE groups SET leader_student_id = ? WHERE id = ?`, [s4.id, groups[3].id]);

      await runQuery(`DELETE FROM cross_eval_assignments WHERE class_id = ?`, [cId]);
      if (s1) await runQuery(`INSERT INTO cross_eval_assignments (class_id, evaluator_student_id, evaluator_name, target_group_id) VALUES (?, ?, ?, ?)`, [cId, s1.id, `${s1.full_name} (Tổ trưởng Tổ 1)`, groups[1].id]);
      if (s2) await runQuery(`INSERT INTO cross_eval_assignments (class_id, evaluator_student_id, evaluator_name, target_group_id) VALUES (?, ?, ?, ?)`, [cId, s2.id, `${s2.full_name} (Tổ trưởng Tổ 2)`, groups[2].id]);
      if (s3) await runQuery(`INSERT INTO cross_eval_assignments (class_id, evaluator_student_id, evaluator_name, target_group_id) VALUES (?, ?, ?, ?)`, [cId, s3.id, `${s3.full_name} (Tổ trưởng Tổ 3)`, groups[3].id]);
      if (s4) await runQuery(`INSERT INTO cross_eval_assignments (class_id, evaluator_student_id, evaluator_name, target_group_id) VALUES (?, ?, ?, ?)`, [cId, s4.id, `${s4.full_name} (Tổ trưởng Tổ 4)`, groups[0].id]);
    }
  } else {
    // Ensure all existing students have password_hash
    await runQuery(`UPDATE students SET password_hash = ? WHERE password_hash IS NULL OR password_hash = ''`, [hashPass]);
    
    // Ensure leaders are assigned for class 1
    const class1 = await getQuery(`SELECT id FROM classes LIMIT 1`);
    if (class1) {
      const gList = await allQuery(`SELECT id FROM groups WHERE class_id = ? ORDER BY id ASC`, [class1.id]);
      for (let idx = 0; idx < gList.length; idx++) {
        const g = gList[idx];
        const leader = await getQuery(`SELECT id, full_name FROM students WHERE class_id = ? AND group_id = ? LIMIT 1`, [class1.id, g.id]);
        if (leader) {
          await runQuery(`UPDATE groups SET leader_student_id = ? WHERE id = ? AND leader_student_id IS NULL`, [leader.id, g.id]);
          const targetGroup = gList[(idx + 1) % gList.length];
          const exists = await getQuery(`SELECT id FROM cross_eval_assignments WHERE class_id = ? AND evaluator_student_id = ?`, [class1.id, leader.id]);
          if (!exists) {
            await runQuery(
              `INSERT INTO cross_eval_assignments (class_id, evaluator_student_id, evaluator_name, target_group_id) VALUES (?, ?, ?, ?)`,
              [class1.id, leader.id, `${leader.full_name} (Tổ trưởng Tổ ${idx + 1})`, targetGroup.id]
            );
          }
        }
      }
    }
    // Ensure monitor roles for sample class
    await runQuery(`UPDATE students SET class_role = 'LOP_TRUONG' WHERE student_code = 'HS10B201'`);
    await runQuery(`UPDATE students SET class_role = 'LOP_PHO' WHERE student_code = 'HS10B202'`);
  }

  // 7. Seed sample behavior events
  const behaviorCount = await getQuery(`SELECT COUNT(*) as count FROM behavior_events`);
  if (behaviorCount.count === 0) {
    const allStudents = await allQuery(`SELECT id FROM students LIMIT 10`);
    const etPenalty1 = await getQuery(`SELECT id FROM event_types WHERE name = 'Không học bài'`);
    const etPenalty2 = await getQuery(`SELECT id FROM event_types WHERE name = 'Đi trễ'`);
    const etBonus1 = await getQuery(`SELECT id FROM event_types WHERE name = 'Giúp bạn'`);
    const etBonus2 = await getQuery(`SELECT id FROM event_types WHERE name = 'Tham gia phong trào tích cực'`);
    const today = new Date().toISOString().split('T')[0];

    if (allStudents.length >= 4 && etPenalty1 && etBonus1) {
      await runQuery(`INSERT INTO behavior_events (student_id, event_type_id, points_applied, note, event_date, created_by_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [allStudents[0].id, etPenalty1.id, -2, 'Không thuộc bài Tiếng Anh', today, 'Cô Nguyễn Thị Mai']);
      await runQuery(`INSERT INTO behavior_events (student_id, event_type_id, points_applied, note, event_date, created_by_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [allStudents[1].id, etPenalty2.id, -1, 'Đi trễ 10 phút', today, 'Cô Nguyễn Thị Mai']);
      await runQuery(`INSERT INTO behavior_events (student_id, event_type_id, points_applied, note, event_date, created_by_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [allStudents[2].id, etBonus1.id, 2, 'Hỗ trợ bạn ôn bài toán', today, 'Lê Thị Bích']);
      await runQuery(`INSERT INTO behavior_events (student_id, event_type_id, points_applied, note, event_date, created_by_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [allStudents[3].id, etBonus2.id, 3, 'Trực nhật xuất sắc', today, 'Lê Thị Bích']);
    }
  }

  // 8. Seed sample Specialized Logs
  const specCount = await getQuery(`SELECT COUNT(*) as count FROM specialized_logs`);
  if (specCount.count === 0) {
    const gvcn = await getQuery(`SELECT id FROM teachers WHERE username = 'gvcn'`);
    const tId = gvcn ? gvcn.id : 1;
    const today = new Date().toISOString().split('T')[0];

    await runQuery(`INSERT INTO specialized_logs (teacher_id, category, title, date, lesson_period, class_name, tech_used, evidence, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      tId, 'Ứng dụng CNTT', 'Sử dụng Canva & Quizizz dạy bài 12', today, 3, '10B2', 'Canva, Quizizz, Tivi thông minh', 'https://drive.google.com/sample', 'Học sinh sôi nổi'
    ]);
    await runQuery(`INSERT INTO specialized_logs (teacher_id, category, title, date, lesson_period, class_name, tech_used, evidence, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      tId, 'Dự giờ', 'Dự giờ tiết Sử cô Lan', today, 2, '10A1', 'Slide PowerPoint', 'Biên bản dự giờ #01', 'Tiết dạy đạt loại Giỏi'
    ]);
  }

  console.log('Database initialized and seeded successfully for all 3 portals!');
}

initDatabase();

module.exports = {
  db,
  dbPath,
  runQuery,
  getQuery,
  allQuery,
  initDatabase
};
