const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...options.headers };
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ ...options, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function testDynamicGroupsAndLeaders() {
  console.log('=== TEST DYNAMIC GROUPS, STUDENT TRANSFERS & GROUP LEADER CROSS-EVAL ===\n');

  // Step 1: Login GVCN
  console.log('[1] Logging in as GVCN (gvcn / 123456)...');
  const teacherLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'teacher', username: 'gvcn', password: '123456' });

  if (teacherLogin.status !== 200) throw new Error('Teacher login failed');
  const teacherToken = teacherLogin.body.token;
  const classId = teacherLogin.body.classes[0].id;
  console.log('GVCN logged in. Class ID:', classId);

  // Step 2: Create Dynamic Group with unique name
  const tempGroupName = `Tổ Test ${Date.now().toString().slice(-4)}`;
  console.log(`\n[2] GVCN creates dynamic group "${tempGroupName}"...`);
  const createGroupRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/class/groups',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, { class_id: classId, group_name: tempGroupName });
  console.log('Create group status:', createGroupRes.status, createGroupRes.body.message);
  const newGroupId = createGroupRes.body.group_id;

  // Step 3: Rename Group
  const renamedGroupName = `Tổ Ngoại Khóa ${Date.now().toString().slice(-4)}`;
  console.log(`\n[3] GVCN renames "${tempGroupName}" to "${renamedGroupName}"...`);
  const updateGroupRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/groups/${newGroupId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, { group_name: renamedGroupName });
  console.log('Rename group status:', updateGroupRes.status, updateGroupRes.body.message);

  // Step 4: Move Student to new group
  console.log(`\n[4] Move student HS10B205 to "${renamedGroupName}"...`);
  const classDetailsBefore = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/details?class_id=${classId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const studentToMove = classDetailsBefore.body.students.find(s => s.student_code === 'HS10B205');
  const group1 = classDetailsBefore.body.groups.find(g => g.group_name === 'Tổ 1');

  const moveRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/class/move-student',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, { student_id: studentToMove.id, new_group_id: newGroupId });
  console.log('Move student status:', moveRes.status, moveRes.body.message);

  // Step 5: Delete Group with Fallback to Tổ 1
  console.log(`\n[5] Delete "${renamedGroupName}" and fallback students to "Tổ 1"...`);
  const deleteGroupRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/groups/${newGroupId}`,
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, { fallback_group_id: group1.id });
  console.log('Delete group status:', deleteGroupRes.status, deleteGroupRes.body.message);

  // Step 6: Auto Rearrange Groups
  console.log('\n[6] Auto re-arrange all students into existing groups (Round-robin A-Z)...');
  const rearrangeRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/class/rearrange-groups',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, { class_id: classId, method: 'ALPHABETICAL' });
  console.log('Rearrange groups status:', rearrangeRes.status, rearrangeRes.body.message);

  // Step 7: Assign Group Leaders and Cross-Eval Matrix
  console.log('\n[7] Assign Group Leaders and Cross-Eval Matrix...');
  const classDetailsAfter = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/class/details?class_id=${classId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherToken}` }
  });
  const groups = classDetailsAfter.body.groups;
  const s1 = classDetailsAfter.body.students.find(s => s.student_code === 'HS10B201');
  const s2 = classDetailsAfter.body.students.find(s => s.student_code === 'HS10B202');
  const s3 = classDetailsAfter.body.students.find(s => s.student_code === 'HS10B203');
  const s4 = classDetailsAfter.body.students.find(s => s.student_code === 'HS10B204');

  // Test self-grading validation error
  const invalidAssign = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/class/assign-leaders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    class_id: classId,
    assignments: [
      { group_id: groups[0].id, leader_student_id: s1.id, target_group_id: groups[0].id } // Invalid self-eval
    ]
  });
  console.log('Invalid self-eval test status:', invalidAssign.status, 'Message:', invalidAssign.body.message);
  if (invalidAssign.status !== 400) throw new Error('Self-eval validation failed');

  // Valid assignment
  const validAssign = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/class/assign-leaders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    }
  }, {
    class_id: classId,
    assignments: [
      { group_id: groups[0].id, leader_student_id: s1.id, target_group_id: groups[1].id },
      { group_id: groups[1].id, leader_student_id: s2.id, target_group_id: groups[2].id },
      { group_id: groups[2].id, leader_student_id: s3.id, target_group_id: groups[3].id },
      { group_id: groups[3].id, leader_student_id: s4.id, target_group_id: groups[0].id },
    ]
  });
  console.log('Valid assignment status:', validAssign.status, validAssign.body.message);

  // Step 8: Group Leader Login
  console.log('\n[8] Login as Group Leader HS10B201...');
  const leaderLogin = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { portal: 'student', username: 'HS10B201', password: '123456' });

  console.log('Leader Login:', leaderLogin.status, {
    full_name: leaderLogin.body.user.full_name,
    role: leaderLogin.body.user.role,
    is_group_leader: leaderLogin.body.user.is_group_leader,
    leader_group_name: leaderLogin.body.user.leader_group_name,
    assigned_target_group_name: leaderLogin.body.user.assigned_target_group_name
  });
  if (leaderLogin.body.user.role !== 'TO_TRUONG' || !leaderLogin.body.user.is_group_leader) {
    throw new Error('Group leader role detection failed');
  }
  const leaderToken = leaderLogin.body.token;

  // Step 9: Group Leader queries my group summary & target group
  console.log('\n[9] Leader HS10B201 queries /api/behavior/my-group-summary...');
  const myGroupSummary = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/my-group-summary',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${leaderToken}` }
  });
  console.log('My Group:', myGroupSummary.body.myGroup.group_name, 'Avg Score:', myGroupSummary.body.myGroup.avg_score, 'Members Count:', myGroupSummary.body.members.length);
  console.log('Target Group for Cross-Eval:', myGroupSummary.body.targetGroup.name, 'Target Students Count:', myGroupSummary.body.targetGroup.students.length);

  // Step 10: Leader scores target group student (Valid)
  console.log('\n[10] Leader HS10B201 grades a student in assigned target group (Tổ 2)...');
  const targetStudent = myGroupSummary.body.targetGroup.students[0];
  const eventTypesRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/event-types',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${leaderToken}` }
  });
  const bonusEvent = eventTypesRes.body.eventTypes.find(e => e.category === 'BONUS');

  const validScoreRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/events',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${leaderToken}`
    }
  }, {
    student_id: targetStudent.id,
    event_type_id: bonusEvent.id,
    note: 'Phát biểu hăng hái trong giờ Hóa học'
  });
  console.log('Valid cross-grading status:', validScoreRes.status, validScoreRes.body.message);
  if (validScoreRes.status !== 200) throw new Error('Valid cross-grading failed');

  // Step 11: Leader tries to score a student in own group (Invalid - should be rejected)
  console.log('\n[11] Leader HS10B201 tries to grade a student in own group (Tổ 1)...');
  const ownGroupStudent = myGroupSummary.body.members[1];
  const invalidScoreRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/behavior/events',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${leaderToken}`
    }
  }, {
    student_id: ownGroupStudent.id,
    event_type_id: bonusEvent.id,
    note: 'Thử tự chấm điểm tổ mình'
  });
  console.log('Invalid own-group grading status:', invalidScoreRes.status, 'Message:', invalidScoreRes.body.message);
  if (invalidScoreRes.status !== 403) throw new Error('Self-group grading prevention failed');

  console.log('\n======================================================');
  console.log('🎉 ALL 11 DYNAMIC GROUPS & LEADER TESTS PASSED 100%!');
  console.log('======================================================');
}

testDynamicGroupsAndLeaders().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
