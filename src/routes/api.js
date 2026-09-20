const express = require('express');
const router = express.Router();

const { 
  authenticateToken, 
  requireRoles, 
  loginLimiter, 
  requireClassOwnership 
} = require('../middlewares/authMiddleware');

const authController = require('../controllers/authController');
const classController = require('../controllers/classController');
const attendanceController = require('../controllers/attendanceController');
const behaviorController = require('../controllers/behaviorController');
const specializedController = require('../controllers/specializedController');
const dashboardController = require('../controllers/dashboardController');

const reportsController = require('../controllers/reportsController');
const rewardsController = require('../controllers/rewardsController');
const badgesController = require('../controllers/badgesController');
const aiController = require('../controllers/aiController');
const backupController = require('../controllers/backupController');
const adminController = require('../controllers/adminController');

// --- Auth Routes ---
router.post('/auth/login', loginLimiter, authController.login);
router.get('/auth/me', authenticateToken, authController.getMe);
router.get('/auth/classes', authenticateToken, authController.getTeacherClasses);

// --- Admin Management Routes (Chỉ Admin) ---
router.get('/admin/overview', authenticateToken, requireRoles('ADMIN'), adminController.getAdminOverview);

// Admin Account Management
router.get('/admin/admins', authenticateToken, requireRoles('ADMIN'), adminController.getAdmins);
router.post('/admin/create-admin', authenticateToken, requireRoles('ADMIN'), adminController.createAdmin);
router.put('/admin/update-admin-password', authenticateToken, requireRoles('ADMIN'), adminController.updateAdminPassword);
router.delete('/admin/delete-admin/:id', authenticateToken, requireRoles('ADMIN'), adminController.deleteAdmin);

// Teacher Management
router.get('/admin/teachers', authenticateToken, requireRoles('ADMIN'), adminController.getTeachers);
router.post('/admin/create-teacher', authenticateToken, requireRoles('ADMIN'), adminController.createTeacher);
router.put('/admin/update-teacher', authenticateToken, requireRoles('ADMIN'), adminController.updateTeacher);
router.post('/admin/reset-teacher-password', authenticateToken, requireRoles('ADMIN'), adminController.resetTeacherPassword);
router.delete('/admin/delete-teacher/:id', authenticateToken, requireRoles('ADMIN'), adminController.deleteTeacher);

// Class & Assignment Management
router.get('/admin/classes', authenticateToken, requireRoles('ADMIN'), adminController.getClasses);
router.post('/admin/create-class', authenticateToken, requireRoles('ADMIN', 'GVCN'), adminController.createClass);
router.post('/admin/assign-teacher', authenticateToken, requireRoles('ADMIN'), adminController.assignTeacherToClass);
router.delete('/admin/delete-class/:id', authenticateToken, requireRoles('ADMIN'), adminController.deleteClass);

// Student Management
router.get('/admin/students', authenticateToken, requireRoles('ADMIN', 'GVCN'), requireClassOwnership, adminController.getClassStudents);
router.post('/admin/add-student', authenticateToken, requireRoles('ADMIN', 'GVCN'), requireClassOwnership, adminController.addStudent);
router.post('/admin/import-students', authenticateToken, requireRoles('ADMIN', 'GVCN'), requireClassOwnership, adminController.importBatchStudents);
router.put('/admin/update-student', authenticateToken, requireRoles('ADMIN', 'GVCN'), requireClassOwnership, adminController.updateStudent);
router.post('/admin/reset-student-password', authenticateToken, requireRoles('ADMIN'), adminController.resetStudentPassword);
router.delete('/admin/delete-student/:id', authenticateToken, requireRoles('ADMIN', 'GVCN'), adminController.deleteStudent);

// --- Multi-Class & Backup Routes ---
router.get('/backup/export', authenticateToken, requireRoles('GVCN', 'ADMIN'), backupController.exportBackup);
router.post('/backup/restore', authenticateToken, requireRoles('ADMIN'), backupController.importRestore);
router.get('/class/list', authenticateToken, classController.getAllClasses);

// --- Phase 4 Routes (Module 9 AI Integration) ---
router.post('/ai/weekly-commentary', authenticateToken, aiController.generateWeeklyCommentary);
router.get('/ai/violation-trends', authenticateToken, aiController.analyzeViolationTrends);
router.post('/ai/draft-parent-message', authenticateToken, aiController.draftParentMessage);

// --- Phase 3 Routes (Module 8 & Module 10 upgrades & Alerts) ---
router.get('/badges/auto', authenticateToken, badgesController.getStudentBadges);
router.get('/students/progress-history', authenticateToken, badgesController.getStudentProgressHistory);
router.get('/alerts/system', authenticateToken, badgesController.getSystemAlerts);

// --- Reports Routes (Module 6) ---
router.get('/reports/weekly', authenticateToken, reportsController.getWeeklyReport);
router.get('/reports/monthly', authenticateToken, reportsController.getMonthlyReport);
router.get('/reports/semester', authenticateToken, reportsController.getSemesterReport);
router.get('/reports/yearly', authenticateToken, reportsController.getSemesterReport);

// --- Rewards Routes (Module 7) ---
router.get('/rewards/auto', authenticateToken, rewardsController.getAutoRewards);

// --- Class & Group Management Routes ---
router.get('/class/details', authenticateToken, requireClassOwnership, classController.getClassDetails);
router.post('/class/groups', authenticateToken, requireRoles('GVCN', 'ADMIN'), requireClassOwnership, classController.createGroup);
router.put('/class/groups/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), classController.updateGroup);
router.delete('/class/groups/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), classController.deleteGroup);
router.post('/class/move-student', authenticateToken, requireRoles('GVCN', 'ADMIN'), classController.moveStudent);
router.post('/class/rearrange-groups', authenticateToken, requireRoles('GVCN', 'ADMIN'), classController.rearrangeGroups);
router.post('/class/assign-leaders', authenticateToken, requireRoles('GVCN', 'ADMIN'), classController.assignLeadersAndCrossEval);
router.put('/class/students/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), classController.updateStudent);
router.post('/class/update-student', authenticateToken, requireRoles('GVCN', 'ADMIN'), classController.updateStudent);

// --- Attendance Routes ---
router.get('/attendance', authenticateToken, requireClassOwnership, attendanceController.getAttendance);
router.post('/attendance', authenticateToken, requireRoles('GVCN', 'BAN_CAN_SU', 'ADMIN', 'LOP_TRUONG', 'LOP_PHO'), attendanceController.saveAttendance);

// --- Behavior & Scoring Routes ---
router.get('/behavior/event-types', authenticateToken, behaviorController.getEventTypes);
router.post('/behavior/event-types', authenticateToken, requireRoles('GVCN', 'ADMIN'), behaviorController.createEventType);
router.put('/behavior/event-types/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), behaviorController.updateEventType);
router.delete('/behavior/event-types/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), behaviorController.deleteEventType);
router.post('/behavior/events', authenticateToken, requireRoles('GVCN', 'TO_TRUONG', 'ADMIN'), behaviorController.logEvent);
router.put('/behavior/events/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), behaviorController.updateEvent);
router.get('/behavior/events', authenticateToken, behaviorController.getBehaviorEvents);
router.delete('/behavior/events/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), behaviorController.deleteEvent);
router.get('/behavior/summary', authenticateToken, behaviorController.getScoringSummary);
router.get('/behavior/my-group-summary', authenticateToken, behaviorController.getMyGroupSummary);

// --- Specialized Logs Routes (Module 1) ---
router.get('/specialized/logs', authenticateToken, specializedController.getLogs);
router.post('/specialized/logs', authenticateToken, requireRoles('GVCN', 'ADMIN'), specializedController.createLog);
router.delete('/specialized/logs/:id', authenticateToken, requireRoles('GVCN', 'ADMIN'), specializedController.deleteLog);

// --- Dashboard Routes ---
router.get('/dashboard/stats', authenticateToken, dashboardController.getDashboardStats);

module.exports = router;
