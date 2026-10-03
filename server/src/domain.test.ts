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

test('task status flow enforces legal transitions, equipment and blocking reason rules', async () => {
  const { createYardTask, updateYardTask, deleteYardTask, assignTask } = await import('./domain.js');
  const task = createYardTask({ kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01-R01-T1', to: '南闸口', priority: 40, scheduledAt: new Date().toISOString(), estimatedMinutes: 12 });
  assert.throws(() => updateYardTask(task.id, { status: 'done' }), /不允许从「排队中」直接变更为「已完成」/);
  assert.throws(() => updateYardTask(task.id, { status: 'executing' }), /不允许从「排队中」/);
  assert.throws(() => updateYardTask(task.id, { status: 'assigned' }), /必须先选择设备|要求已指派设备/);
  assert.throws(() => updateYardTask(task.id, { status: 'assigned', equipmentId: 'RS-02' }), /维护中|不能指派/);
  assert.throws(() => updateYardTask(task.id, { status: 'blocked' }), /阻塞原因/);
  const blocked = updateYardTask(task.id, { status: 'blocked', blockingReasons: ['等待海关查验窗口'] });
  assert.equal(blocked?.status, 'blocked');
  const requeued = updateYardTask(task.id, { status: 'queued' });
  assert.equal(requeued?.status, 'queued');
  assert.deepEqual(requeued?.blockingReasons, []);
  assert.equal(updateYardTask(task.id, { status: 'assigned', equipmentId: 'YC-05' })?.status, 'assigned');
  assert.throws(() => updateYardTask(task.id, { status: 'done' }), /不允许从「已指派」/);
  assert.equal(updateYardTask(task.id, { status: 'executing' })?.status, 'executing');
  assert.throws(() => updateYardTask(task.id, { status: 'queued' }), /不允许从「作业中」/);
  assert.equal(updateYardTask(task.id, { status: 'done' })?.status, 'done');
  assert.throws(() => updateYardTask(task.id, { status: 'queued' }), /已完成/);
  assert.throws(() => updateYardTask(task.id, { priority: 60 }), /已完成/);
  assert.throws(() => assignTask(task.id, 'YC-05'), /已完成/);
  assert.equal(deleteYardTask(task.id)?.id, task.id);
});

test('inspect tasks require reach-stacker equipment when assigned through the edit flow', async () => {
  const { createYardTask, updateYardTask, deleteYardTask } = await import('./domain.js');
  const task = createYardTask({ kind: 'inspect', containerId: 'TGHU-9831204', from: 'D05-R02-T1', to: 'D05-R02-T1', priority: 90, scheduledAt: new Date().toISOString(), estimatedMinutes: 30 });
  assert.throws(() => updateYardTask(task.id, { status: 'assigned', equipmentId: 'YC-05' }), /正面吊/);
  assert.throws(() => createYardTask({ kind: 'deliver', containerId: 'MSCU-4829017', from: 'A01', to: 'B07', priority: 40, scheduledAt: new Date().toISOString(), estimatedMinutes: 10, equipmentId: 'RS-02' }), /不能指派/);
  assert.equal(deleteYardTask(task.id)?.id, task.id);
});
