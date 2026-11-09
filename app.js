"use strict";

var STORAGE_KEY = "ghi-tien-danh-bai.v1";
var PALETTE = ["#f97316", "#16a34a", "#dc2626", "#2563eb", "#ca8a04", "#7c3aed", "#0d9488", "#db2777"];
var TAGS = ["Chặt heo", "Thối heo", "Phạt", "Tới trắng"];
var QUICK = [5, 10, 20, 50, 100];

var state = { sessions: [] };
var create = null;
var drafts = {};
var pad = null;
var sheet = null;
var undo = null;
var pendingNav = null;
var toastTimer = 0;
var app;
var layer;
var toastEl;

function boot() {
  app = document.getElementById("app");
  layer = document.getElementById("overlay");
  toastEl = document.getElementById("toast");
  load();
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  document.getElementById("import-file").addEventListener("change", onFile);
  window.addEventListener("hashchange", function () { pad = null; if (sheet) clearSheet(); render(); });
  window.addEventListener("popstate", onPop);
  render();
}

function route() {
  var hash = location.hash || "#/";
  if (hash === "#/new") return { name: "create" };
  var m = /^#\/s\/([^/?#]+)$/.exec(hash);
  if (m) return { name: "session", id: decodeURIComponent(m[1]) };
  return { name: "home" };
}

function go(hash) {
  if ((location.hash || "#/") === hash) render();
  else location.hash = hash;
}

function render() {
  var r = route();
  document.body.dataset.screen = r.name;
  document.body.classList.toggle("pad-open", !!pad);
  if (r.name === "create") {
    if (!create) create = freshCreate();
    app.innerHTML = createHtml();
  } else if (r.name === "session") {
    var s = sessionById(r.id);
    app.innerHTML = s ? sessionHtml(s) : missingHtml();
    document.title = s ? s.name + " · Ghi tiền" : "Ghi tiền";
  } else {
    app.innerHTML = homeHtml();
    document.title = "Ghi tiền đánh bài";
  }
}

/* ---------- home ---------- */

function homeHtml() {
  var cards = sortedSessions().map(function (s) {
    var top = leader(s, sessionNets(s));
    return '<button type="button" class="item" data-act="open" data-id="' + esc(s.id) + '">' +
      '<span class="item-main"><b>' + esc(s.name) + "</b><small>" + esc(s.players.map(function (p) { return p.name; }).join(", ")) + "</small></span>" +
      '<span class="item-side"><small>' + s.rounds.length + " ván</small>" + (top ? "<small>" + esc(top) + "</small>" : "") + "</span></button>";
  }).join("");
  return '<div class="screen">' +
    '<header class="bar"><h1>Ghi tiền đánh bài</h1></header>' +
    '<main class="page">' +
    (cards ? '<div class="list">' + cards + "</div>" : '<p class="empty">Chưa có bàn nào. Bấm <b>Bàn mới</b> để bắt đầu.</p>') +
    '<div class="tools">' +
    (state.sessions.length ? '<button type="button" data-act="export">Xuất sổ</button>' : "") +
    '<button type="button" data-act="import">Nhập sổ</button>' +
    (state.sessions.length ? '<button type="button" class="red" data-act="wipe">Xóa hết</button>' : "") +
    "</div></main>" +
    '<footer class="foot"><button type="button" class="btn primary" data-act="new">Bàn mới</button></footer></div>';
}

/* ---------- create ---------- */

function freshCreate() {
  var last = sortedSessions()[0];
  return {
    players: last ? last.players.map(function (p) { return { id: GT.uid(), name: p.name, color: p.color }; }) : [],
    error: ""
  };
}

function recentNames() {
  var have = {};
  create.players.forEach(function (p) { have[p.name.toLowerCase()] = true; });
  var out = [];
  sortedSessions().forEach(function (s) {
    s.players.forEach(function (p) {
      var k = p.name.toLowerCase();
      if (!have[k] && out.length < 12) { have[k] = true; out.push(p.name); }
    });
  });
  return out;
}

function createHtml() {
  var c = create;
  var people = c.players.map(function (p) {
    return '<span class="tag on">' + esc(p.name) + '<button type="button" data-act="unadd" data-id="' + esc(p.id) + '" aria-label="Bỏ ' + esc(p.name) + '">×</button></span>';
  }).join("");
  var recent = recentNames().map(function (name) {
    return '<button type="button" class="tag" data-act="readd" data-name="' + esc(name) + '">+ ' + esc(name) + "</button>";
  }).join("");
  return '<div class="screen">' +
    bar("Bàn mới", "back") +
    '<main class="page">' +
    '<p class="label">Người chơi (' + c.players.length + ")</p>" +
    (people ? '<div class="tags">' + people + "</div>" : "") +
    '<div class="add"><input id="add-name" maxlength="24" placeholder="Nhập tên rồi bấm Thêm" autocomplete="off" enterkeyhint="done"><button type="button" class="btn" data-act="add">Thêm</button></div>' +
    (recent ? '<p class="label">Người quen</p><div class="tags">' + recent + "</div>" : "") +
    "</main>" +
    '<footer class="foot">' + (c.error ? '<p class="msg red">' + esc(c.error) + "</p>" : "") +
    '<button type="button" class="btn primary" data-act="start">Vào bàn</button></footer></div>';
}

function addCreatePlayer(name) {
  name = cleanName(name);
  if (!name) return false;
  if (create.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) {
    create.error = name + " đã có.";
    return false;
  }
  if (create.players.length >= 10) { create.error = "Tối đa 10 người."; return false; }
  create.players.push({ id: GT.uid(), name: name, color: nextColor(create.players) });
  create.error = "";
  return true;
}

function startTable() {
  var pending = document.getElementById("add-name");
  if (pending && pending.value.trim()) addCreatePlayer(pending.value);
  if (create.players.length < 2) { create.error = "Cần ít nhất 2 người."; render(); return; }
  var s = {
    id: GT.uid(),
    name: defaultName(),
    date: GT.isoDate(new Date()),
    players: create.players.map(function (p) { return { id: p.id, name: p.name, color: p.color }; }),
    rounds: [],
    updatedAt: new Date().toISOString()
  };
  state.sessions.unshift(s);
  create = null;
  save();
  history.replaceState(null, "", "#/");
  go("#/s/" + s.id);
}

/* ---------- session ---------- */

function draftOf(s) {
  if (!drafts[s.id]) drafts[s.id] = { vals: {}, tags: [] };
  return drafts[s.id];
}

function planOf(s) {
  var d = draftOf(s);
  var amounts = {};
  s.players.forEach(function (p) {
    if (d.vals[p.id] != null) amounts[p.id] = { value: d.vals[p.id], bad: false };
  });
  return GT.planRound(s, { amounts: amounts });
}

function sessionHtml(s) {
  var d = draftOf(s);
  var plan = planOf(s);
  var nets = sessionNets(s);
  var rows = s.players.map(function (p) {
    var v = d.vals[p.id];
    var auto = plan.filled && plan.filled.id === p.id;
    if (auto) v = plan.filled.amount;
    var total = nets[p.id] || 0;
    var cls = (pad && pad.id === p.id ? " sel" : "") + (auto ? " auto" : "");
    var val = v == null ? '<span class="val none">—</span>'
      : '<span class="val ' + (v > 0 ? "plus" : v < 0 ? "minus" : "") + '">' + esc(GT.formatSignedK(v)) + "</span>";
    return '<button type="button" class="row' + cls + '" data-act="pick" data-id="' + esc(p.id) + '">' +
      '<span class="who"><b>' + esc(p.name) + '</b><small class="' + (total > 0 ? "plus" : total < 0 ? "minus" : "") + '">Tổng ' + esc(GT.formatSignedK(total)) + "</small></span>" +
      (auto ? '<small class="auto-tag">tự tính</small>' : "") + val + "</button>";
  }).join("");
  var tags = TAGS.map(function (t) {
    var on = d.tags.indexOf(t) !== -1;
    return '<button type="button" class="tag' + (on ? " on" : "") + '" data-act="tag" data-v="' + esc(t) + '">' + esc(t) + "</button>";
  }).join("");
  return '<div class="screen">' +
    bar(s.name, "home", true) +
    '<main class="page">' +
    '<p class="label">Ván ' + (s.rounds.length + 1) + ' <span class="hint">· chạm tên để nhập tiền</span></p>' +
    '<div class="rows">' + rows + "</div>" +
    '<div class="tags small">' + tags + "</div>" +
    settleHtml(s, nets) +
    historyHtml(s) +
    "</main>" +
    (pad ? padHtml(s) : footHtml(s, plan)) +
    "</div>";
}

function footHtml(s, plan) {
  var d = draftOf(s);
  var any = Object.keys(d.vals).some(function (k) { return d.vals[k] != null; });
  var msg = plan.ok ? '<span class="plus">Tổng = 0</span>' : '<span class="' + (plan.tone === "bad" ? "minus" : "") + '">' + esc(plan.message) + "</span>";
  return '<footer class="foot savebar"><div class="status">' + msg +
    (any ? '<button type="button" class="link" data-act="clear">Làm lại</button>' : "") + "</div>" +
    '<button type="button" class="btn primary" data-act="save"' + (plan.ok ? "" : " disabled") + ">Lưu ván</button></footer>";
}

function padHtml(s) {
  var p = playerById(s, pad.id);
  var entry = pad.entry ? Number(pad.entry) : 0;
  var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map(function (k) {
    return '<button type="button" data-act="key" data-k="' + k + '"' + (k === "C" || k === "⌫" ? ' class="fn"' : "") + ">" + k + "</button>";
  }).join("");
  var quick = QUICK.map(function (q) {
    return '<button type="button" data-act="quick" data-v="' + q + '">+' + q + "</button>";
  }).join("");
  return '<div class="pad" role="dialog" aria-label="Nhập tiền">' +
    '<div class="pad-top"><span class="pad-name">' + esc(p ? p.name : "") + '</span><span class="pad-num">' + esc(entry ? GT.formatK(entry * 1000) : "0") + "</span>" +
    '<button type="button" class="x" data-act="pad-close" aria-label="Đóng">×</button></div>' +
    '<div class="pad-quick">' + quick + "</div>" +
    '<div class="pad-grid"><div class="pad-keys">' + keys + "</div>" +
    '<div class="pad-commit"><button type="button" class="lose" data-act="commit" data-sign="-1">− Thua</button>' +
    '<button type="button" class="win" data-act="commit" data-sign="1">+ Ăn</button></div></div></div>';
}

function settleHtml(s, nets) {
  if (!s.rounds.length) return "";
  var pays = GT.simplifyNets(nets);
  var body = pays.length
    ? pays.map(function (p) {
      return "<li><span>" + esc(nameOf(s, p.from)) + ' <i>trả</i> ' + esc(nameOf(s, p.to)) + "</span><b>" + esc(GT.formatK(p.amount)) + "</b></li>";
    }).join("")
    : '<li><span>Hòa cả bàn</span></li>';
  return '<section class="box"><div class="box-head"><h2>Chốt sổ</h2><button type="button" class="link" data-act="share">Gửi</button></div><ul class="pays">' + body + "</ul></section>";
}

function historyHtml(s) {
  if (!s.rounds.length) return "";
  var ids = s.players.map(function (p) { return p.id; });
  var items = s.rounds.map(function (r, i) {
    var nets = GT.netsFromEntries(r.entries || [], ids);
    var parts = s.players.filter(function (p) { return nets[p.id]; }).map(function (p) {
      var v = nets[p.id];
      return '<span class="' + (v > 0 ? "plus" : "minus") + '">' + esc(p.name) + " " + esc(GT.formatSignedK(v)) + "</span>";
    }).join("");
    return '<li><div class="h-top"><b>Ván ' + (i + 1) + "</b><small>" + esc(formatTime(r.at)) + (r.note ? " · " + esc(r.note) : "") + "</small>" +
      '<button type="button" class="link red" data-act="del-round" data-id="' + esc(r.id) + '">Xóa</button></div><div class="h-vals">' + parts + "</div></li>";
  }).reverse().join("");
  return '<section class="box"><div class="box-head"><h2>Các ván</h2></div><ul class="hist">' + items + "</ul></section>";
}

function missingHtml() {
  return '<div class="screen">' + bar("Không thấy bàn", "home") + '<main class="page"><p class="empty">Bàn này không còn trên máy.</p></main></div>';
}

function bar(title, back, menu) {
  return '<header class="bar"><button type="button" class="x" data-act="' + back + '" aria-label="Quay lại">‹</button><h1>' + esc(title) + "</h1>" +
    (menu ? '<button type="button" class="x" data-act="menu" aria-label="Tùy chọn">⋯</button>' : '<span class="x"></span>') + "</header>";
}

/* ---------- pad ---------- */

function openPad(s, id) {
  var v = draftOf(s).vals[id];
  pad = { id: id, entry: v ? String(Math.round(Math.abs(v) / 1000)) : "" };
  render();
  var row = app.querySelector('.row.sel');
  if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function commitPad(s, sign) {
  var d = draftOf(s);
  var entry = Number(pad.entry || 0);
  d.vals[pad.id] = entry ? sign * entry * 1000 : null;
  var empty = s.players.filter(function (p) { return d.vals[p.id] == null; });
  if (empty.length <= 1) { pad = null; render(); return; }
  var start = s.players.findIndex(function (p) { return p.id === pad.id; });
  var next = null;
  for (var i = 1; i <= s.players.length; i++) {
    var cand = s.players[(start + i) % s.players.length];
    if (d.vals[cand.id] == null) { next = cand; break; }
  }
  openPad(s, next.id);
}

/* ---------- sheets ---------- */

function openSheet(next) {
  var wasOpen = !!sheet;
  if (!toastEl.hidden) { undo = null; hideToast(); }
  sheet = next;
  if (!wasOpen) history.pushState({ sheet: true }, "", location.href);
  paintSheet();
}

function clearSheet() {
  sheet = null;
  layer.hidden = true;
  layer.innerHTML = "";
}

function closeSheet(nav) {
  if (!sheet) { if (nav) go(nav); return; }
  clearSheet();
  if (history.state && history.state.sheet) {
    pendingNav = nav || null;
    history.back();
  } else if (nav) {
    go(nav);
  }
}

function onPop() {
  if (sheet) clearSheet();
  if (pendingNav) {
    var nav = pendingNav;
    pendingNav = null;
    go(nav);
  }
}

function paintSheet() {
  layer.hidden = false;
  layer.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + sheetInner() + "</div>";
  var auto = layer.querySelector("[data-autofocus]");
  if (auto) auto.focus();
}

function sheetInner() {
  var head = function (t) { return '<div class="sheet-head"><h2>' + esc(t) + '</h2><button type="button" class="x" data-act="close" aria-label="Đóng">×</button></div>'; };
  if (sheet.type === "menu") {
    return head(sessionById(sheet.sid).name) + '<div class="menu">' +
      '<button type="button" data-act="rename">Đổi tên bàn</button>' +
      '<button type="button" data-act="players">Người chơi</button>' +
      '<button type="button" data-act="share">Gửi kết quả</button>' +
      '<button type="button" class="red" data-act="del-session">Xóa bàn này</button></div>';
  }
  if (sheet.type === "rename") {
    return head("Đổi tên bàn") + '<input class="input" id="rename-input" maxlength="40" value="' + esc(sheet.value) + '" data-autofocus enterkeyhint="done">' +
      '<button type="button" class="btn primary" data-act="rename-save">Lưu</button>';
  }
  if (sheet.type === "players") {
    var rows = sheet.rows.map(function (r) {
      return '<div class="prow"><input class="input" data-prow="' + esc(r.id) + '" maxlength="24" value="' + esc(r.name) + '">' +
        (r.locked ? '<small>Đã chơi</small>' : '<button type="button" class="link red" data-act="prow-del" data-id="' + esc(r.id) + '">Bỏ</button>') + "</div>";
    }).join("");
    return head("Người chơi") + rows +
      '<div class="add"><input id="prow-new" class="input" maxlength="24" placeholder="Thêm người" autocomplete="off" enterkeyhint="done"><button type="button" class="btn" data-act="prow-add">Thêm</button></div>' +
      (sheet.error ? '<p class="msg red">' + esc(sheet.error) + "</p>" : "") +
      '<button type="button" class="btn primary" data-act="players-save">Lưu</button>';
  }
  if (sheet.type === "confirm") {
    return head(sheet.title) + '<p class="msg">' + esc(sheet.body) + "</p>" +
      '<button type="button" class="btn danger" data-act="confirm">' + esc(sheet.ok) + "</button>" +
      '<button type="button" class="btn" data-act="close">Thôi</button>';
  }
  return "";
}

/* ---------- events ---------- */

function onClick(e) {
  if (e.target === layer) { closeSheet(); return; }
  var el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  var act = el.dataset.act;
  var id = el.dataset.id;
  var s = currentSession();

  switch (act) {
    case "home": go("#/"); return;
    case "back": create = null; go("#/"); return;
    case "new": create = freshCreate(); go("#/new"); return;
    case "open": go("#/s/" + id); return;
    case "export": exportLedger(); return;
    case "import": document.getElementById("import-file").click(); return;
    case "wipe":
      openSheet({ type: "confirm", title: "Xóa hết sổ?", body: "Mọi bàn trên máy này sẽ mất.", ok: "Xóa hết", run: function () {
        state.sessions = []; drafts = {}; save(); closeSheet("#/"); toast("Đã xóa sổ.");
      } });
      return;
    case "add": {
      var added = addCreatePlayer(document.getElementById("add-name").value);
      render();
      if (added) focusLater("add-name");
      return;
    }
    case "readd": addCreatePlayer(el.dataset.name); render(); return;
    case "unadd": create.players = create.players.filter(function (p) { return p.id !== id; }); render(); return;
    case "start": startTable(); return;
    case "undo": runUndo(); return;
    case "close": closeSheet(); return;
  }

  if (s && !sheet) {
    var d = draftOf(s);
    switch (act) {
      case "pick": openPad(s, id); return;
      case "pad-close": pad = null; render(); return;
      case "key": {
        var k = el.dataset.k;
        if (k === "C") pad.entry = "";
        else if (k === "⌫") pad.entry = pad.entry.slice(0, -1);
        else if (pad.entry.length < 6) pad.entry = (pad.entry === "0" ? "" : pad.entry) + k;
        updatePadNum();
        return;
      }
      case "quick": pad.entry = String(Number(pad.entry || 0) + Number(el.dataset.v)); updatePadNum(); return;
      case "commit": commitPad(s, Number(el.dataset.sign)); return;
      case "tag": {
        var at = d.tags.indexOf(el.dataset.v);
        if (at === -1) d.tags.push(el.dataset.v); else d.tags.splice(at, 1);
        render();
        return;
      }
      case "clear": drafts[s.id] = null; pad = null; render(); return;
      case "save": saveRound(s); return;
      case "menu": pad = null; render(); openSheet({ type: "menu", sid: s.id }); return;
      case "share": shareResult(s); return;
      case "del-round": deleteRound(s, id); return;
    }
  }

  if (!sheet) return;
  switch (act) {
    case "share": shareResult(sessionById(sheet.sid)); return;
    case "rename": openSheet({ type: "rename", sid: sheet.sid, value: sessionById(sheet.sid).name }); return;
    case "rename-save": {
      var ss = sessionById(sheet.sid);
      var name = document.getElementById("rename-input").value.trim();
      if (name) { ss.name = name.slice(0, 40); touch(ss); save(); }
      closeSheet(); render();
      return;
    }
    case "players": openPlayers(sessionById(sheet.sid)); return;
    case "prow-add": addPlayerRow(); return;
    case "prow-del": readRows(); sheet.rows = sheet.rows.filter(function (r) { return r.id !== id; }); paintSheet(); return;
    case "players-save": savePlayers(); return;
    case "del-session": {
      var target = sessionById(sheet.sid);
      openSheet({ type: "confirm", title: "Xóa bàn này?", body: "“" + target.name + "” và " + target.rounds.length + " ván sẽ mất.", ok: "Xóa bàn", run: function () {
        state.sessions = state.sessions.filter(function (x) { return x.id !== target.id; });
        save(); closeSheet("#/"); toast("Đã xóa bàn.");
      } });
      return;
    }
    case "confirm": if (sheet.run) sheet.run(); return;
  }
}

function updatePadNum() {
  var el = app.querySelector(".pad-num");
  var entry = Number(pad.entry || 0);
  if (el) el.textContent = entry ? GT.formatK(entry * 1000) : "0";
}

function onKey(e) {
  if (e.key === "Escape") {
    if (sheet) { closeSheet(); return; }
    if (pad) { pad = null; render(); return; }
  }
  var t = e.target;
  if (pad && !sheet && t.tagName !== "INPUT") {
    var s = currentSession();
    if (/^[0-9]$/.test(e.key) && pad.entry.length < 6) { pad.entry = (pad.entry === "0" ? "" : pad.entry) + e.key; updatePadNum(); return; }
    if (e.key === "Backspace") { pad.entry = pad.entry.slice(0, -1); updatePadNum(); return; }
    if (e.key === "-" && s) { commitPad(s, -1); return; }
    if ((e.key === "+" || e.key === "Enter") && s) { e.preventDefault(); commitPad(s, e.key === "+" ? 1 : -1); return; }
  }
  if (e.key !== "Enter") return;
  if (t.id === "add-name") {
    e.preventDefault();
    var added = addCreatePlayer(t.value);
    render();
    if (added) focusLater("add-name");
  } else if (t.id === "prow-new") {
    e.preventDefault(); addPlayerRow();
  } else if (t.id === "rename-input") {
    e.preventDefault(); layer.querySelector("[data-act=rename-save]").click();
  }
}

function focusLater(id) {
  setTimeout(function () { var el = document.getElementById(id); if (el) el.focus(); }, 0);
}

/* ---------- actions ---------- */

function saveRound(s) {
  var plan = planOf(s);
  if (!plan.ok) return;
  var d = draftOf(s);
  var round = { id: GT.uid(), at: new Date().toISOString(), entries: plan.entries };
  if (d.tags.length) round.note = d.tags.join(", ");
  s.rounds.push(round);
  drafts[s.id] = null;
  pad = null;
  touch(s);
  save();
  render();
  window.scrollTo(0, 0);
  setUndo({ sid: s.id, kind: "add", roundId: round.id }, "Đã lưu ván " + s.rounds.length + ".");
}

function deleteRound(s, id) {
  var idx = s.rounds.findIndex(function (r) { return r.id === id; });
  if (idx < 0) return;
  var removed = s.rounds.splice(idx, 1)[0];
  touch(s);
  save();
  render();
  setUndo({ sid: s.id, kind: "del", index: idx, round: removed }, "Đã xóa ván " + (idx + 1) + ".");
}

function setUndo(item, label) {
  toast('<span>' + esc(label) + '</span><button type="button" data-act="undo">Hoàn tác</button>', 6000);
  undo = item;
}

function runUndo() {
  var item = undo;
  undo = null;
  hideToast();
  if (!item) return;
  var s = sessionById(item.sid);
  if (!s) return;
  if (item.kind === "add") s.rounds = s.rounds.filter(function (r) { return r.id !== item.roundId; });
  else s.rounds.splice(Math.min(item.index, s.rounds.length), 0, item.round);
  touch(s);
  save();
  render();
  toast("Đã hoàn tác.");
}

function openPlayers(s) {
  openSheet({
    type: "players",
    sid: s.id,
    error: "",
    rows: s.players.map(function (p) { return { id: p.id, name: p.name, color: p.color, locked: locked(s, p.id) }; })
  });
}

function readRows() {
  layer.querySelectorAll("[data-prow]").forEach(function (input) {
    sheet.rows.forEach(function (r) { if (r.id === input.dataset.prow) r.name = input.value; });
  });
}

function addPlayerRow() {
  readRows();
  var input = document.getElementById("prow-new");
  var name = cleanName(input && input.value);
  if (!name) return;
  if (sheet.rows.some(function (r) { return cleanName(r.name).toLowerCase() === name.toLowerCase(); })) { sheet.error = name + " đã có."; paintSheet(); return; }
  if (sheet.rows.length >= 10) { sheet.error = "Tối đa 10 người."; paintSheet(); return; }
  sheet.rows.push({ id: GT.uid(), name: name, color: nextColor(sheet.rows), locked: false });
  sheet.error = "";
  paintSheet();
  focusLater("prow-new");
}

function savePlayers() {
  readRows();
  var s = sessionById(sheet.sid);
  var names = sheet.rows.map(function (r) { return cleanName(r.name); });
  var lower = names.map(function (n) { return n.toLowerCase(); });
  var err = "";
  if (names.length < 2) err = "Cần ít nhất 2 người.";
  else if (names.some(function (n) { return !n; })) err = "Tên không được trống.";
  else if (new Set(lower).size !== lower.length) err = "Có tên bị trùng.";
  if (err) { sheet.error = err; paintSheet(); return; }
  s.players = sheet.rows.map(function (r, i) { return { id: r.id, name: names[i], color: r.color }; });
  drafts[s.id] = null;
  touch(s);
  save();
  closeSheet();
  render();
  toast("Đã lưu người chơi.");
}

function shareResult(s) {
  var text = resultText(s);
  if (navigator.share) {
    navigator.share({ text: text }).catch(function (err) {
      if (err && err.name !== "AbortError") copyText(text);
    });
  } else {
    copyText(text);
  }
}

function copyText(text) {
  var done = function () { toast("Đã chép. Dán vào Zalo hoặc Messenger."); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text); done(); });
  } else { legacyCopy(text); done(); }
}

function legacyCopy(text) {
  var a = document.createElement("textarea");
  a.value = text;
  a.setAttribute("readonly", "");
  a.style.position = "fixed";
  a.style.opacity = "0";
  document.body.appendChild(a);
  a.select();
  document.execCommand("copy");
  a.remove();
}

function resultText(s) {
  var nets = sessionNets(s);
  var pays = GT.simplifyNets(nets);
  var lines = [s.name + " · " + s.rounds.length + " ván", ""];
  s.players.slice().sort(function (a, b) { return (nets[b.id] || 0) - (nets[a.id] || 0); }).forEach(function (p) {
    lines.push(p.name + ": " + GT.formatSigned(nets[p.id] || 0));
  });
  lines.push("");
  if (!pays.length) lines.push("Hòa cả bàn.");
  else {
    lines.push("Chốt:");
    pays.forEach(function (p) { lines.push("• " + nameOf(s, p.from) + " trả " + nameOf(s, p.to) + " " + GT.formatMoney(p.amount)); });
  }
  return lines.join("\n");
}

function onFile(e) {
  var file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var clean;
    try { clean = GT.sanitizeBundle(JSON.parse(String(reader.result))); } catch (err) { clean = null; }
    if (!clean || !clean.sessions.length) { toast("File không phải sổ nợ."); return; }
    var apply = function () { state.sessions = clean.sessions; drafts = {}; save(); closeSheet("#/"); toast("Đã nhập " + clean.sessions.length + " bàn."); };
    if (!state.sessions.length) apply();
    else openSheet({ type: "confirm", title: "Thay sổ trên máy?", body: "File có " + clean.sessions.length + " bàn. Sổ hiện tại sẽ bị thay.", ok: "Thay sổ", run: apply });
  };
  reader.readAsText(file);
}

function exportLedger() {
  var blob = new Blob([JSON.stringify({ v: 1, sessions: state.sessions }, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "ghi-tien-danh-bai-" + GT.isoDate(new Date()) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}

/* ---------- toast ---------- */

function toast(html, ms) {
  undo = null;
  toastEl.hidden = false;
  toastEl.innerHTML = html.indexOf("<") === -1 ? "<span>" + esc(html) + "</span>" : html;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { undo = null; hideToast(); }, ms || 2600);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
  toastEl.innerHTML = "";
}

/* ---------- storage + helpers ---------- */

function load() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    var clean = raw ? GT.sanitizeBundle(JSON.parse(raw)) : null;
    state.sessions = clean ? clean.sessions : [];
  } catch (err) {
    state.sessions = [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, sessions: state.sessions }));
  } catch (err) {
    toast("Không lưu được trên máy này.");
  }
}

function currentSession() {
  var r = route();
  return r.name === "session" ? sessionById(r.id) : null;
}

function sessionById(id) {
  for (var i = 0; i < state.sessions.length; i++) if (state.sessions[i].id === id) return state.sessions[i];
  return null;
}

function playerById(s, id) {
  for (var i = 0; i < s.players.length; i++) if (s.players[i].id === id) return s.players[i];
  return null;
}

function sortedSessions() {
  return state.sessions.slice().sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function sessionNets(s) {
  return GT.netFromRounds(s.players.map(function (p) { return p.id; }), s.rounds);
}

function leader(s, nets) {
  if (!s.rounds.length) return "";
  var top = s.players.slice().sort(function (a, b) { return (nets[b.id] || 0) - (nets[a.id] || 0); })[0];
  if (!nets[top.id]) return "Đang hòa";
  return top.name + " +" + GT.formatK(nets[top.id]);
}

function locked(s, id) {
  return s.rounds.some(function (r) {
    return (r.entries || []).some(function (e) { return e.from === id || e.to === id; });
  });
}

function touch(s) { s.updatedAt = new Date().toISOString(); }

function nameOf(s, id) {
  var p = playerById(s, id);
  return p ? p.name : "?";
}

function nextColor(list) {
  var used = list.map(function (p) { return p.color; });
  for (var i = 0; i < PALETTE.length; i++) if (used.indexOf(PALETTE[i]) === -1) return PALETTE[i];
  return PALETTE[list.length % PALETTE.length];
}

function cleanName(v) {
  return String(v || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function defaultName() {
  var d = new Date();
  var part = d.getHours() < 11 ? "Sáng" : d.getHours() < 18 ? "Chiều" : "Tối";
  return part + " " + d.getDate() + "/" + (d.getMonth() + 1);
}

function formatTime(iso) {
  var d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

boot();
