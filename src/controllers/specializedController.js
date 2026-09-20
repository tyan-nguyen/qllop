const { runQuery, getQuery, allQuery } = require('../db/sqlite');

async function getLogs(req, res) {
  try {
    const { category } = req.query;
    let sql = `SELECT * FROM specialized_logs WHERE 1=1`;
    const params = [];

    if (category && category !== 'ALL') {
      sql += ` AND category = ?`;
      params.push(category);
    }
    sql += ` ORDER BY date DESC, id DESC`;

    const logs = await allQuery(sql, params);
    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lấy nhật ký chuyên môn' });
  }
}

async function createLog(req, res) {
  try {
    const { category, title, date, lesson_period, class_name, tech_used, evidence, note } = req.body;
    if (!category || !title) {
      return res.status(400).json({ message: 'Vui lòng chọn danh mục và nhập tên hoạt động' });
    }

    const dateStr = date || new Date().toISOString().split('T')[0];

    await runQuery(`
      INSERT INTO specialized_logs (category, title, date, lesson_period, class_name, tech_used, evidence, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [category, title, dateStr, lesson_period || null, class_name || '', tech_used || '', evidence || '', note || '']);

    return res.json({ message: 'Thêm hoạt động chuyên môn thành công!' });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi tạo hoạt động chuyên môn' });
  }
}

async function deleteLog(req, res) {
  try {
    const { id } = req.params;
    await runQuery(`DELETE FROM specialized_logs WHERE id = ?`, [id]);
    return res.json({ message: 'Đã xóa hoạt động chuyên môn' });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi xóa hoạt động chuyên môn' });
  }
}

module.exports = {
  getLogs,
  createLog,
  deleteLog
};
