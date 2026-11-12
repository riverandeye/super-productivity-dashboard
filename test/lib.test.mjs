import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const L = createRequire(import.meta.url)('../src/lib.js');
const D = (s) => L.parseDayStr(s);
// local-time timestamp of a given day and hour
const at = (s, h = 12) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, h).getTime();
};
const task = (o) => ({ isDone: false, subTaskIds: [], projectId: 'P', parentId: null, created: 0, ...o });
const projects = [
  { id: 'INBOX_PROJECT', title: 'Inbox', theme: { primary: '#999' } },
  { id: 'P', title: 'Proj', theme: { primary: '#ef5350' }, taskIds: [] },
  { id: 'Q', title: 'Other', theme: { primary: '#26c6da' }, taskIds: [] },
  { id: 'A', title: 'Archived', isArchived: true, taskIds: [] },
];

test('day helpers round-trip', () => {
  assert.equal(L.dayNumToStr(D('2026-11-12')), '2026-11-12');
  assert.equal(L.msToDayNum(at('2026-03-01'), 0), D('2026-03-01'));
  assert.equal(L.msToDayNum(at('2026-03-01', 2), 4 * 3600e3), D('2026-02-28'));
  assert.equal(L.dow(D('2026-11-15')), 0, 'a Sunday');
});

test('skips Inbox and archived projects, keeps order', () => {
  const m = L.buildModel({ todayStr: '2026-11-12', projects, tasks: [] });
  assert.deepEqual(m.projects.map((p) => p.id), ['P', 'Q']);
  assert.equal(m.overall.total, 0);
  assert.equal(m.overall.ratio, 0);
});

test('leaves, completion, effort days (archived included, parents count for days)', () => {
  const m = L.buildModel({
    todayStr: '2026-11-12',
    projects,
    tasks: [
      task({ id: 'a', subTaskIds: ['a1', 'a2', 'a3'] }),
      task({ id: 'a1', parentId: 'a', isDone: true, doneOn: at('2026-11-10') }),
      task({ id: 'a2', parentId: 'a', isDone: true, doneOn: at('2026-11-10', 20) }),
      task({ id: 'a3', parentId: 'a' }),
      task({ id: 'b' }), // leaf (no subtasks)
      task({ id: 'c', isDone: true, doneOn: at('2026-11-11') }),
    ],
    archivedTasks: [
      task({ id: 'z', isDone: true, doneOn: at('2026-11-01'), subTaskIds: ['z1'] }),
      task({ id: 'z1', parentId: 'z', isDone: true, doneOn: at('2026-10-31') }),
    ],
  });
  const p = m.projects[0];
  // leaves: a1 a2 a3 b c z1
  assert.equal(p.total, 6);
  assert.equal(p.done, 4);
  assert.equal(p.effortDays, 4, '10-31, 11-01 (parent z), 11-10, 11-11');
  assert.equal(m.overall.effortDays, 4);
  assert.equal(p.firstDay, D('2026-10-31'));
});

test("a done parent counts its open subtasks as done", () => {
  const m = L.buildModel({
    todayStr: '2026-11-12',
    projects,
    tasks: [
      task({ id: 'a', isDone: true, doneOn: at('2026-11-12'), subTaskIds: ['a1'] }),
      task({ id: 'a1', parentId: 'a' }),
    ],
  });
  assert.equal(m.projects[0].done, 1);
  assert.equal(m.projects[0].doneToday, 1);
});

test("today's planned items, points to gain and points gained", () => {
  const m = L.buildModel({
    todayStr: '2026-11-12',
    projects,
    tasks: [
      task({ id: 'a', title: 'Book', subTaskIds: ['a1', 'a2', 'a3', 'a4'] }),
      task({ id: 'a1', parentId: 'a', dueDay: '2026-11-12', isDone: true, doneOn: at('2026-11-12') }),
      task({ id: 'a2', parentId: 'a', dueDay: '2026-11-12' }),
      task({ id: 'a3', parentId: 'a', dueDay: '2026-11-13' }),
      task({ id: 'a4', parentId: 'a', dueDay: '2026-11-11' }),
      task({ id: 'q', projectId: 'Q', dueWithTime: at('2026-11-12', 9) }),
      task({ id: 'q2', projectId: 'Q', isDone: true, doneOn: at('2026-11-12', 8) }), // unplanned, checked today
    ],
  });
  const [p, q] = m.projects;
  assert.equal(p.plannedToday, 1);
  assert.equal(p.todayGainPts, 25);
  assert.equal(p.doneToday, 1);
  assert.equal(p.gainedPts, 25);
  assert.equal(q.plannedToday, 1);
  assert.equal(q.gainedPts, 50);
  assert.equal(m.overall.plannedToday, 2);
  assert.equal(m.overall.todayGainPts, (2 / 6) * 100);
  assert.deepEqual(m.todayItems.map((l) => l.id), ['a2', 'a1', 'q', 'q2']);
  assert.equal(m.todayItems[0].parentTitle, 'Book');
  assert.deepEqual(m.overdue.map((l) => l.id), ['a4']);
  assert.equal(m.overall.checkedToday, true);
});

test('pace and projected finish against dated plan', () => {
  // 10 items, one per day from 11-01 to 11-10; today 11-06 -> 5 due before today.
  const tasks = [task({ id: 'p', subTaskIds: [] })];
  for (let i = 1; i <= 10; i++) {
    const day = `2026-11-${String(i).padStart(2, '0')}`;
    tasks.push(task({ id: 's' + i, parentId: 'p', dueDay: day, ...(i <= 3 ? { isDone: true, doneOn: at(day) } : {}) }));
  }
  const m = L.buildModel({ todayStr: '2026-11-06', projects, tasks });
  const p = m.projects[0];
  assert.equal(p.dated, 10);
  assert.equal(p.pace, -2, 'behind by 2');
  assert.equal(p.planEnd, D('2026-11-10'));
  assert.equal(p.projectedEnd, D('2026-11-12'), 'plan end + 2 days at 1 item/day');
  assert.equal(m.overall.pace, -2);
  // burndown: 11-01..11-12, plan hits 0 on 11-10, actual through today
  const b = p.burndown;
  assert.equal(b.start, D('2026-11-01'));
  assert.equal(b.end, D('2026-11-12'));
  assert.equal(b.plan[0], 9);
  assert.equal(b.plan[9], 0);
  assert.deepEqual(b.actual, [9, 8, 7, 7, 7, 7]);
});

test('ahead of plan finishes early, never before today', () => {
  const tasks = [];
  for (let i = 1; i <= 10; i++) {
    tasks.push(task({ id: 's' + i, dueDay: `2026-11-${String(10 + i)}`, ...(i <= 4 ? { isDone: true, doneOn: at('2026-11-11') } : {}) }));
  }
  const m = L.buildModel({ todayStr: '2026-11-12', projects, tasks });
  const p = m.projects[0];
  assert.equal(p.pace, 3, '4 done, 1 due before today');
  assert.equal(p.projectedEnd, D('2026-11-17'));
});

test('streaks', () => {
  const done = (id, day) => task({ id, isDone: true, doneOn: at(day) });
  const m = L.buildModel({
    todayStr: '2026-11-12',
    projects,
    tasks: [done('a', '2026-11-01'), done('b', '2026-11-02'), done('c', '2026-11-03'), done('d', '2026-11-10'), done('e', '2026-11-11')],
  });
  assert.equal(m.overall.streak, 2, 'yesterday and the day before; today still open');
  assert.equal(m.overall.bestStreak, 3);
  assert.equal(m.heat[D('2026-11-10')], 1);
});

test('future planned items feed the plan heatmap', () => {
  const m = L.buildModel({
    todayStr: '2026-11-12',
    projects,
    tasks: [task({ id: 'a', dueDay: '2026-11-20' }), task({ id: 'b', dueDay: '2026-11-20' }), task({ id: 'c', dueDay: '2026-11-01' })],
  });
  assert.equal(m.heatPlan[D('2026-11-20')], 2);
  assert.equal(m.heatPlan[D('2026-11-01')], undefined);
});
