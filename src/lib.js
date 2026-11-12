// Dashboard: pure data model. No DOM, no PluginAPI: index.html renders the
// result and test/lib.test.mjs checks it under node.
//
// Days are integer "day numbers" (days since 1970-01-01 in the calendar,
// independent of time zone), so ranges are plain ints.
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var INBOX_ID = 'INBOX_PROJECT';

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 'YYYY-MM-DD' -> day number, or null. */
  function parseDayStr(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }

  /**
   * Timestamp (ms) -> day number of the local calendar day it falls on, shifted
   * by the app's start-of-next-day offset (a check at 01:00 with a 2h offset
   * counts for the previous day, like the app does).
   */
  function msToDayNum(ms, dayOffsetMs) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null;
    var d = new Date(ms - (dayOffsetMs || 0));
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }

  function dayNumToStr(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** Day of week of a day number, 0 = Sunday. */
  function dow(n) {
    return new Date(n * DAY_MS).getUTCDay();
  }

  /** Planned day: dueWithTime wins over dueDay, as in the app. */
  function planDayOf(t) {
    if (typeof t.dueWithTime === 'number' && t.dueWithTime) return msToDayNum(t.dueWithTime, 0);
    return parseDayStr(t.dueDay);
  }

  function doneDayOf(t, off) {
    if (!t.isDone || !t.doneOn) return null;
    return msToDayNum(t.doneOn, off);
  }

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  /**
   * Build the dashboard model.
   * @param {object} input
   *   tasks, archivedTasks: Task[] from PluginAPI
   *   projects: Project[] from PluginAPI.getAllProjects()
   *   todayStr: 'YYYY-MM-DD' (getDayContext().todayStr, or local today)
   *   dayOffsetMs: startOfNextDayDiffMs (0 if unknown)
   */
  function buildModel(input) {
    var off = input.dayOffsetMs || 0;
    var today = parseDayStr(input.todayStr);
    if (today == null) today = msToDayNum(Date.now(), off);

    // Active tasks win over archived copies of the same id.
    var byId = {};
    (input.archivedTasks || []).forEach(function (t) {
      if (t && t.id) byId[t.id] = { t: t, archived: true };
    });
    (input.tasks || []).forEach(function (t) {
      if (t && t.id) byId[t.id] = { t: t, archived: false };
    });
    var childrenOf = {};
    Object.keys(byId).forEach(function (id) {
      var t = byId[id].t;
      if (t.parentId) (childrenOf[t.parentId] = childrenOf[t.parentId] || []).push(id);
    });

    var projects = (input.projects || []).filter(function (p) {
      return p && p.id !== INBOX_ID && !p.isArchived;
    });
    var order = {};
    projects.forEach(function (p, i) {
      order[p.id] = i;
    });

    var stats = {};
    projects.forEach(function (p) {
      stats[p.id] = newStats(p);
    });

    // Every task counts toward the days of effort and the heatmap; only leaves
    // (subtasks, or tasks without subtasks) count toward completion.
    var heat = {}; // day -> checks
    var heatPlan = {}; // day -> planned leaves (not done)
    var allDays = {};
    Object.keys(byId).forEach(function (id) {
      var e = byId[id];
      var t = e.t;
      var parent = t.parentId ? byId[t.parentId] : null;
      var pid = t.projectId || (parent && parent.t.projectId) || '';
      var s = stats[pid];
      if (!s) return;
      var dd = doneDayOf(t, off);
      if (dd != null) {
        s.days[dd] = true;
        s.heat[dd] = (s.heat[dd] || 0) + 1;
        s.checks.push({
          id: t.id,
          title: t.title || '',
          parentTitle: parent ? parent.t.title || '' : null,
          day: dd,
          plan: planDayOf(t),
          archived: e.archived,
        });
        allDays[dd] = true;
        heat[dd] = (heat[dd] || 0) + 1;
      }
      // Top-level tasks: progress per task (book, chapter group, ...).
      var topId = parent ? parent.t.id : t.id;
      var topT = parent ? parent.t : t;
      var row = s.taskRows[topId];
      if (!row) {
        row = s.taskRows[topId] = { id: topId, title: topT.title || '', total: 0, done: 0, items: [], planStart: null, planEnd: null, archived: e.archived && !parent, order: s.taskOrder.length };
        s.taskOrder.push(topId);
      }
      var isLeaf = !!t.parentId || !(childrenOf[t.id] && childrenOf[t.id].length);
      if (!isLeaf) return;
      var plan = planDayOf(t);
      // A done parent counts its open subtasks as done: the app shows them so.
      var done = !!t.isDone || !!(parent && parent.t.isDone);
      var leaf = {
        id: t.id,
        title: t.title || '',
        parentId: parent ? parent.t.id : null,
        parentTitle: parent ? parent.t.title || '' : null,
        projectId: pid,
        plan: plan,
        done: done,
        doneDay: done ? (dd != null ? dd : parent ? doneDayOf(parent.t, off) : null) : null,
        archived: e.archived,
        isDoneSelf: !!t.isDone,
      };
      s.leaves.push(leaf);
      s.total++;
      if (done) s.done++;
      row.total++;
      if (done) row.done++;
      row.items.push({ id: t.id, title: leaf.title, plan: plan, done: done, doneDay: leaf.doneDay });
      if (plan != null) {
        if (row.planStart == null || plan < row.planStart) row.planStart = plan;
        if (row.planEnd == null || plan > row.planEnd) row.planEnd = plan;
      }
      if (plan != null) {
        s.dated++;
        if (s.planStart == null || plan < s.planStart) s.planStart = plan;
        if (s.planEnd == null || plan > s.planEnd) s.planEnd = plan;
        if (plan < today) s.dueBefore++;
        if (done) s.datedDone++;
        if (!done && plan >= today) {
          heatPlan[plan] = (heatPlan[plan] || 0) + 1;
          s.heatPlan[plan] = (s.heatPlan[plan] || 0) + 1;
        }
      }
      if (done && leaf.doneDay === today) s.doneToday++;
      if (plan === today) {
        s.todayItems.push(leaf);
        if (!done) s.plannedToday++;
      } else if (plan != null && plan < today && !done) {
        s.overdue.push(leaf);
      }
    });

    var list = projects.map(function (p) {
      return finishStats(stats[p.id], today);
    });

    var total = 0;
    var done = 0;
    var plannedToday = 0;
    var doneToday = 0;
    var dated = 0;
    var dueBefore = 0;
    var datedDone = 0;
    var todayItems = [];
    var overdue = [];
    list.forEach(function (s) {
      total += s.total;
      done += s.done;
      plannedToday += s.plannedToday;
      doneToday += s.doneToday;
      dated += s.dated;
      dueBefore += s.dueBefore;
      datedDone += s.datedDone;
      todayItems = todayItems.concat(s.todayItems);
      overdue = overdue.concat(s.overdue);
    });
    todayItems.sort(function (a, b) {
      return (order[a.projectId] - order[b.projectId]) || (a.done === b.done ? 0 : a.done ? 1 : -1);
    });
    overdue.sort(function (a, b) {
      return a.plan - b.plan || order[a.projectId] - order[b.projectId];
    });

    var streak = streaks(allDays, today);
    return {
      today: today,
      projects: list,
      overall: {
        total: total,
        done: done,
        ratio: total ? done / total : 0,
        effortDays: Object.keys(allDays).length,
        plannedToday: plannedToday,
        doneToday: doneToday,
        todayGainPts: total ? (plannedToday / total) * 100 : 0,
        gainedPts: total ? (doneToday / total) * 100 : 0,
        dated: dated,
        pace: dated ? datedDone - dueBefore : null,
        streak: streak.current,
        bestStreak: streak.best,
        checkedToday: !!allDays[today],
      },
      todayItems: todayItems,
      overdue: overdue,
      heat: heat,
      heatPlan: heatPlan,
    };
  }

  function newStats(p) {
    var idx = {};
    (p.taskIds || []).concat(p.backlogTaskIds || []).forEach(function (id, i) {
      idx[id] = i;
    });
    return {
      taskIdx: idx,
      id: p.id,
      title: p.title || '',
      color: (p.theme && p.theme.primary) || null,
      icon: p.icon || null,
      leaves: [],
      days: {},
      total: 0,
      done: 0,
      dated: 0,
      datedDone: 0,
      dueBefore: 0,
      planStart: null,
      planEnd: null,
      plannedToday: 0,
      doneToday: 0,
      todayItems: [],
      overdue: [],
      heat: {},
      heatPlan: {},
      checks: [],
      taskRows: {},
      taskOrder: [],
    };
  }

  function finishStats(s, today) {
    var st = streaks(s.days, today);
    s.streak = st.current;
    s.bestStreak = st.best;
    s.checkedToday = !!s.days[today];
    // Today panel for the project: planned for today, plus anything checked
    // today that was planned for another day (or none).
    s.leaves.forEach(function (l) {
      if (l.done && l.doneDay === today && l.plan !== today) s.todayItems.push(l);
    });
    s.todayItems.sort(function (a, b) {
      return a.done === b.done ? 0 : a.done ? 1 : -1;
    });
    s.overdue.sort(function (a, b) {
      return a.plan - b.plan;
    });
    var BIG = 1e9;
    s.tasks = s.taskOrder
      .map(function (id) {
        var r = s.taskRows[id];
        r.ratio = r.total ? r.done / r.total : 0;
        r.items.sort(function (a, b) {
          var pa = a.plan == null ? Infinity : a.plan;
          var pb = b.plan == null ? Infinity : b.plan;
          return pa - pb;
        });
        r.dueBefore = r.items.filter(function (x) {
          return x.plan != null && x.plan < today;
        }).length;
        r.datedDone = r.items.filter(function (x) {
          return x.plan != null && x.done;
        }).length;
        r.order = id in s.taskIdx ? s.taskIdx[id] : BIG + r.order;
        return r;
      })
      .sort(function (a, b) {
        return a.order - b.order;
      });
    delete s.taskRows;
    delete s.taskIdx;
    delete s.taskOrder;
    var days = Object.keys(s.days)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    s.effortDays = days.length;
    s.firstDay = days.length ? days[0] : null;
    s.lastDay = days.length ? days[days.length - 1] : null;
    s.ratio = s.total ? s.done / s.total : 0;
    s.todayGainPts = s.total ? (s.plannedToday / s.total) * 100 : 0;
    s.gainedPts = s.total ? (s.doneToday / s.total) * 100 : 0;
    // Pace: dated items done vs dated items planned before today. Today's own
    // items are not yet late, so they don't count against the pace.
    s.pace = s.dated ? s.datedDone - s.dueBefore : null;
    s.projectedEnd = projectEnd(s, today);
    s.burndown = s.dated ? burndown(s, today) : null;
    delete s.days;
    return s;
  }

  /**
   * Projected finish day: the plan end, moved by the pace (items ahead or
   * behind) at the plan's average rate of items per day. Once the plan end has
   * passed, the actual rate of checks since the start is used instead.
   */
  function projectEnd(s, today) {
    if (!s.total || !s.dated) return null;
    var remaining = s.total - s.done;
    if (remaining === 0) return s.lastDay != null ? s.lastDay : today;
    if (s.planEnd >= today) {
      var planRate = s.dated / (s.planEnd - s.planStart + 1);
      var shifted = s.planEnd - Math.round(s.pace / planRate);
      return Math.max(today, shifted);
    }
    var start = s.planStart;
    if (s.firstDay != null && s.firstDay < start) start = s.firstDay;
    if (!s.done) return null;
    var rate = s.done / (today - start + 1);
    return today + Math.ceil(remaining / rate);
  }

  /**
   * Remaining leaves per day: plan (if every item were done on its planned
   * day) and actual (up to today). Undated leaves stay in both lines.
   */
  function burndown(s, today) {
    var start = s.planStart;
    if (s.firstDay != null && s.firstDay < start) start = s.firstDay;
    var end = Math.max(s.planEnd, today);
    if (s.projectedEnd != null && s.projectedEnd > end) end = Math.min(s.projectedEnd, end + 365);
    var planCount = {};
    var doneCount = {};
    s.leaves.forEach(function (l) {
      if (l.plan != null) planCount[l.plan] = (planCount[l.plan] || 0) + 1;
      if (l.done && l.doneDay != null) doneCount[l.doneDay] = (doneCount[l.doneDay] || 0) + 1;
    });
    // Items planned or done before the chart start are folded into day one.
    var plan = [];
    var actual = [];
    var planLeft = s.total;
    var doneLeft = s.total;
    Object.keys(planCount).forEach(function (d) {
      if (+d < start) planLeft -= planCount[d];
    });
    Object.keys(doneCount).forEach(function (d) {
      if (+d < start) doneLeft -= doneCount[d];
    });
    // Done items without a day (e.g. done before doneOn existed) count from day one.
    var undatedDone = s.leaves.filter(function (l) {
      return l.done && l.doneDay == null;
    }).length;
    doneLeft -= undatedDone;
    for (var d = start; d <= end; d++) {
      planLeft -= planCount[d] || 0;
      plan.push(planLeft);
      if (d <= today) {
        doneLeft -= doneCount[d] || 0;
        actual.push(doneLeft);
      }
    }
    return { start: start, end: end, total: s.total, plan: plan, actual: actual };
  }

  function streaks(daySet, today) {
    var days = Object.keys(daySet)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    var best = 0;
    var run = 0;
    var prev = null;
    days.forEach(function (d) {
      run = prev != null && d === prev + 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    // The current streak survives until the end of today even if nothing is
    // checked yet today.
    var cur = 0;
    var d = daySet[today] ? today : today - 1;
    while (daySet[d]) {
      cur++;
      d--;
    }
    return { current: cur, best: best };
  }

  var api = {
    DAY_MS: DAY_MS,
    parseDayStr: parseDayStr,
    msToDayNum: msToDayNum,
    dayNumToStr: dayNumToStr,
    dow: dow,
    planDayOf: planDayOf,
    round1: round1,
    buildModel: buildModel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DashLib = api;
})(this);
