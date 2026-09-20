const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { getQuery } = require('../db/sqlite');

const JWT_SECRET = process.env.JWT_SECRET || 'tro-ly-so-gv-secret-key-2026';

// 1. Giới hạn số lần đăng nhập sai để chống Brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 30, // Tối đa 30 lần thử / 15 phút mỗi IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Tài khoản hoặc địa chỉ IP của bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút!'
  }
});

// 2. Xác thực JWT Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Không tìm thấy token xác thực' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
    }
    req.user = user;
    next();
  });
}

// 3. Phân quyền theo vai trò (Role-Based Access Control)
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
    }
    next();
  };
}

// 4. Kiểm tra quyền sở hữu lớp học (Chống IDOR / Can thiệp chéo giữa các giáo viên)
async function requireClassOwnership(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Yêu cầu đăng nhập' });
    }

    // Admin có quyền truy cập toàn bộ các lớp
    if (user.role === 'ADMIN') {
      return next();
    }

    // Lấy class_id từ query, params hoặc body
    const classId = req.query.class_id || req.body.class_id || req.params.class_id;

    if (!classId) {
      return next();
    }

    if (user.role === 'GVCN') {
      const cls = await getQuery(`SELECT * FROM classes WHERE id = ?`, [classId]);
      if (!cls) {
        return res.status(404).json({ message: 'Lớp học không tồn tại' });
      }

      // Nếu lớp đã được phân công cho GV khác và GV hiện tại không phải GVCN của lớp này
      if (cls.teacher_id && cls.teacher_id !== user.id) {
        return res.status(403).json({
          message: `Từ chối truy cập: Lớp "${cls.class_name}" do giáo viên khác chủ nhiệm. Bạn chỉ có quyền thao tác trên lớp của mình.`
        });
      }
    }

    next();
  } catch (err) {
    console.error('Check class ownership error:', err);
    return res.status(500).json({ message: 'Lỗi kiểm tra quyền hạn lớp học' });
  }
}

// 5. Kiểm tra độ an toàn mật khẩu (tối thiểu 6 ký tự)
function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string' || password.trim().length < 6) {
    return {
      valid: false,
      message: 'Mật khẩu phải có độ dài tối thiểu từ 6 ký tự trở lên để đảm bảo an toàn'
    };
  }
  return { valid: true };
}

module.exports = {
  JWT_SECRET,
  loginLimiter,
  authenticateToken,
  requireRoles,
  requireClassOwnership,
  validatePasswordStrength
};
