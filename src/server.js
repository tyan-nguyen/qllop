const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const apiRouter = require('./routes/api');
const { initDatabase } = require('./db/sqlite');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Bảo mật HTTP Security Headers qua Helmet
app.use(helmet({
  contentSecurityPolicy: false, // Để cho phép rendering các tài nguyên canvas/in ấn nội bộ
  crossOriginEmbedderPolicy: false
}));

// 2. Cấu hình CORS linh hoạt theo biến môi trường
const envOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
];

const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

app.use(cors({
  origin: function (origin, callback) {
    // Cho phép requests không có origin (ví dụ mobile apps, postman, curl, server-to-server)
    if (!origin) return callback(null, true);
    
    // Nếu có trong danh sách cho phép
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Fallback cho môi trường phát triển
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked: Origin ${origin} is not allowed`));
  },
  credentials: true
}));

// 3. Giới hạn tần suất gọi API chung (General Rate Limiter)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 1000, // Tối đa 1000 requests / 15 phút mỗi IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Bạn đã gửi quá nhiều yêu cầu đến máy chủ. Vui lòng thử lại sau ít phút!'
  }
});

app.use('/api', generalLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Routes API
app.use('/api', apiRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Trợ lý số GV THPT Backend Server running cleanly & securely' });
});

// 5. Phục vụ Frontend Build (Single-Port Production Deployment)
const fs = require('fs');
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`Backend Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`API Health Check: http://localhost:${PORT}/api/health`);
  console.log(`Bảo mật: Helmet & Rate Limiter đã được kích hoạt`);
  console.log(`===================================================`);
});
