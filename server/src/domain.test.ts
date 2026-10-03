import test from 'node:test'; import assert from 'node:assert/strict'; import { containerPlan, dashboard, gateConflicts, prioritizeTasks } from './domain.js';
test('dashboard aggregates berth, yard, gate and exception signals', () => { const data = dashboard(); assert.equal(data.activeVoyages, 2); assert.ok(data.yardUtilization > 0.7); assert.ok(data.blockedTasks >= 1); });
test('gate conflict engine detects same truck overlap', () => { const conflicts = gateConflicts(); assert.ok(conflicts.some(item => item.appointmentId === 'APT-9001' || item.appointmentId === 'APT-9004')); });
test('yard planner respects reefer and hazmat constraints', () => { const plan = containerPlan('TGHU-9831204'); assert.equal(plan?.recommendedBlock?.hazmatAllowed, true); assert.ok(plan?.reasons.some(reason => reason.includes('危险品'))); });
test('priority queue promotes customs inspection work', () => { const tasks = prioritizeTasks(); assert.equal(tasks[0].containerId, 'TGHU-9831204'); });

test('container create, update and delete form a complete audited CRUD cycle', async () => {
  const { createContainer, updateContainer, deleteContainer, containers } = await import('./domain.js');
  const created = createContainer({ id: 'TEST-CRUD-0001', voyageId: 'VOY-AX7', size: '20', isoType: '22G1', direction: 'import', status: 'in-yard', weightT: 10, reefer: false, customs: 'released', priority: 'normal', yardSlot: 'C03-R11-T1' });
  assert.equal(created.id, 'TEST-CRUD-0001');
  assert.equal(updateContainer(created.id, { weightT: 12 })?.weightT, 12);
  assert.equal(deleteContainer(created.id)?.id, 'TEST-CRUD-0001');
  assert.equal(containers.some(item => item.id === 'TEST-CRUD-0001'), false);
});

test('appointment and task domain operations support create, update and delete', async () => {
  const { createGateAppointment, editGateAppointment, deleteGateAppointment, createYardTask, updateYardTask, deleteYardTask } = await import('./domain.js');
  const appointment = createGateAppointment({ containerId: 'MSCU-4829017', truckNo: 'TEST-CRUD-01', driver: '测试司机', type: 'pickup', windowStart: new Date(Date.now()+3600000).toISOString(), windowEnd: new Date(Date.now()+7200000).toISOString(), lane: 'north' });
  assert.equal(editGateAppointment(appointment.id, { driver: '更新司机' })?.driver, '更新司机');
  assert.equal(deleteGateAppointment(appointment.id)?.id, appointment.id);
  const task = createYardTask({ kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01-R01-T1', to: '南闸口', priority: 40, scheduledAt: new Date().toISOString(), estimatedMinutes: 12 });
  assert.equal(updateYardTask(task.id, { to: '北闸口' })?.to, '北闸口');
  assert.equal(deleteYardTask(task.id)?.id, task.id);
});

test('task status machine rejects illegal transitions and explains the allowed next steps', async () => {
  const { createYardTask, updateYardTask, deleteYardTask } = await import('./domain.js');
  const task = createYardTask({ kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01-R01-T1', to: '南闸口', priority: 50, scheduledAt: new Date().toISOString(), estimatedMinutes: 15 });
  assert.throws(() => updateYardTask(task.id, { status: 'done' }), /非法状态转换.*排队.*已完成/);
  assert.throws(() => updateYardTask(task.id, { status: 'executing' }), /非法状态转换/);
  assert.equal(updateYardTask(task.id, { status: 'assigned', equipmentId: 'YC-05' })?.status, 'assigned');
  assert.equal(updateYardTask(task.id, { status: 'executing' })?.status, 'executing');
  assert.throws(() => updateYardTask(task.id, { to: '北闸口' }), /执行中/);
  assert.throws(() => updateYardTask(task.id, { status: 'queued' }), /非法状态转换/);
  assert.equal(updateYardTask(task.id, { status: 'done' })?.status, 'done');
  assert.throws(() => updateYardTask(task.id, { status: 'queued' }), /终态/);
  assert.throws(() => updateYardTask(task.id, { priority: 60 }), /终态/);
  deleteYardTask(task.id);
});

test('assigning and blocking a task enforce equipment rules and blocking reasons', async () => {
  const { createYardTask, updateYardTask, deleteYardTask } = await import('./domain.js');
  const task = createYardTask({ kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01-R01-T1', to: '南闸口', priority: 50, scheduledAt: new Date().toISOString(), estimatedMinutes: 15 });
  assert.throws(() => updateYardTask(task.id, { status: 'assigned' }), /必须选择一台可用设备/);
  assert.throws(() => updateYardTask(task.id, { status: 'assigned', equipmentId: 'RS-02' }), /维护中/);
  assert.throws(() => updateYardTask(task.id, { status: 'blocked' }), /阻塞原因/);
  const blocked = updateYardTask(task.id, { status: 'blocked', blockingReason: '待海关查验窗口' });
  assert.equal(blocked?.status, 'blocked');
  assert.ok(blocked?.blockingReasons.includes('待海关查验窗口'));
  const resumed = updateYardTask(task.id, { status: 'queued' });
  assert.equal(resumed?.status, 'queued');
  assert.deepEqual(resumed?.blockingReasons, []);
  assert.equal(updateYardTask(task.id, { status: 'assigned', equipmentId: 'YC-05' })?.equipmentId, 'YC-05');
  assert.throws(() => updateYardTask(task.id, { equipmentId: '' }), /必须保留设备/);
  deleteYardTask(task.id);
});

test('inspect tasks require a reach stacker and done tasks reject reassignment', async () => {
  const { createYardTask, updateYardTask, assignTask, deleteYardTask } = await import('./domain.js');
  const inspect = createYardTask({ kind: 'inspect', containerId: 'TGHU-9831204', from: 'D05-R02-T1', to: 'D05-R02-T1', priority: 80, scheduledAt: new Date().toISOString(), estimatedMinutes: 30 });
  assert.throws(() => updateYardTask(inspect.id, { status: 'assigned', equipmentId: 'YC-05' }), /正面吊/);
  deleteYardTask(inspect.id);
  assert.throws(() => assignTask('TASK-105', 'YC-05'), /已完成/);
});
