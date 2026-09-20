const { allQuery, getQuery } = require('./src/db/sqlite');

async function check() {
  const users = await allQuery(`SELECT * FROM users`);
  console.log('USERS:', users);
  const teachers = await allQuery(`SELECT * FROM teachers`);
  console.log('TEACHERS:', teachers);
  const students = await allQuery(`SELECT COUNT(*) as count FROM students`);
  console.log('STUDENTS COUNT:', students);
  const classes = await allQuery(`SELECT * FROM classes`);
  console.log('CLASSES:', classes);
}

check();
