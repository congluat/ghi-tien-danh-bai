"use strict";

var GT = (function () {
  var MONEY_CAP = 1000000000;

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isPosInt(n) {
    return typeof n === "number" && isFinite(n) && Math.round(n) === n && n > 0 && n <= MONEY_CAP;
  }

  function formatPlain(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v)) return "";
    var abs = new Intl.NumberFormat("vi-VN").format(Math.abs(v));
    return v < 0 ? "-" + abs : abs;
  }

  function formatMoney(n) {
    return formatPlain(Math.abs(n)) + "đ";
  }

  function formatSigned(n) {
    var v = Math.round(Number(n));
    if (!v) return "0đ";
    return (v > 0 ? "+" : "−") + formatPlain(Math.abs(v)) + "đ";
  }

  function decimalVi(x) {
    return String(Math.round(x * 100) / 100).replace(".", ",");
  }

  function formatK(n) {
    var v = Math.abs(Math.round(Number(n) || 0));
    if (!v) return "0";
    if (v >= 1000000 && v % 100000 === 0) return decimalVi(v / 1000000) + "tr";
    if (v % 100 === 0) return decimalVi(v / 1000) + "k";
    return formatPlain(v) + "đ";
  }

  function formatSignedK(n) {
    var v = Math.round(Number(n) || 0);
    if (!v) return "0";
    return (v > 0 ? "+" : "−") + formatK(v);
  }

  function parseK(raw) {
    if (raw == null) return { state: "empty", value: null };
    var s = String(raw).trim().toLowerCase().replace(/\s+/g, "");
    if (!s) return { state: "empty", value: null };
    s = s.replace(/k$/, "").replace(",", ".");
    if (!/^\d+(\.\d{0,2})?$/.test(s)) return { state: "invalid", value: null };
    var x = parseFloat(s);
    if (!isFinite(x)) return { state: "invalid", value: null };
    if (x === 0) return { state: "ok", value: 0 };
    var value = x >= 1000 ? Math.round(x) : Math.round(x * 1000);
    if (!isPosInt(value)) return { state: "invalid", value: null };
    return { state: "ok", value: value };
  }

  function kValue(n) {
    if (!isPosInt(n)) return "";
    return String(Math.round(n / 10) / 100);
  }

  function rankName(index, count) {
    if (index === count - 1) return "Bét";
    return ["Nhất", "Nhì", "Ba", "Tư", "Năm"][index] || String(index + 1);
  }

  function fail(tone, message) {
    return { ok: false, tone: tone, message: message, entries: [], nets: null, filled: null };
  }

  // draft.amounts: { [playerId]: { value: signed number | null, bad: bool } }
  // Exactly one empty row gets the remainder so the round sums to 0.
  function planRound(session, draft) {
    if (!session || !draft || !session.players || session.players.length < 2) {
      return fail("bad", "Cần ít nhất 2 người.");
    }
    var amounts = draft.amounts || {};
    var nets = {};
    var empty = [];
    var sum = 0;
    var any = false;
    for (var i = 0; i < session.players.length; i++) {
      var p = session.players[i];
      var a = amounts[p.id];
      if (a && a.bad) return fail("bad", "Số tiền của " + p.name + " chưa đúng.");
      if (!a || a.value == null) { empty.push(p); nets[p.id] = 0; continue; }
      nets[p.id] = a.value;
      sum += a.value;
      if (a.value) any = true;
    }
    if (!any) return fail("hint", "Nhập tiền từng người. Tổng phải bằng 0.");
    var filled = null;
    if (sum !== 0 && empty.length === 1) {
      filled = { id: empty[0].id, amount: -sum };
      nets[filled.id] = -sum;
      sum = 0;
    }
    if (sum !== 0) return fail("bad", "Tổng đang " + formatSignedK(sum) + ", phải bằng 0.");
    var entries = simplifyNets(nets).map(function (x) {
      return { t: "pay", from: x.from, to: x.to, amount: x.amount };
    });
    return { ok: true, tone: "ok", message: "", entries: entries, nets: nets, filled: filled };
  }

  function netsFromEntries(entries, playerIds) {
    var nets = {};
    var i;
    for (i = 0; i < playerIds.length; i++) nets[playerIds[i]] = 0;
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || e.t !== "pay") continue;
      if (nets[e.from] == null || nets[e.to] == null) continue;
      nets[e.from] -= e.amount;
      nets[e.to] += e.amount;
    }
    return nets;
  }

  function netFromRounds(playerIds, rounds) {
    var all = [];
    rounds.forEach(function (r) { (r.entries || []).forEach(function (e) { all.push(e); }); });
    return netsFromEntries(all, playerIds);
  }

  function simplifyNets(nets) {
    var debtors = [];
    var creditors = [];
    Object.keys(nets).forEach(function (id) {
      var v = Math.round(nets[id] || 0);
      if (v < 0) debtors.push({ id: id, left: -v });
      else if (v > 0) creditors.push({ id: id, left: v });
    });
    debtors.sort(function (a, b) { return b.left - a.left; });
    creditors.sort(function (a, b) { return b.left - a.left; });
    var pays = [];
    var i = 0;
    var j = 0;
    while (i < debtors.length && j < creditors.length) {
      var amount = Math.min(debtors[i].left, creditors[j].left);
      if (amount > 0) pays.push({ from: debtors[i].id, to: creditors[j].id, amount: amount });
      debtors[i].left -= amount;
      creditors[j].left -= amount;
      if (debtors[i].left === 0) i += 1;
      if (creditors[j].left === 0) j += 1;
    }
    return pays;
  }

  function sanitizeBundle(data) {
    if (!data || !Array.isArray(data.sessions)) return null;
    var sessions = [];
    var seen = {};
    data.sessions.forEach(function (raw) {
      var clean = sanitizeSession(raw, seen);
      if (clean) sessions.push(clean);
    });
    sessions.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    return { v: 1, sessions: sessions.slice(0, 100) };
  }

  function sanitizeSession(raw, seen) {
    if (!raw || typeof raw.id !== "string" || seen[raw.id]) return null;
    if (!Array.isArray(raw.players) || !Array.isArray(raw.rounds)) return null;
    var players = [];
    var ids = {};
    for (var i = 0; i < raw.players.length && players.length < 10; i++) {
      var p = raw.players[i];
      if (!p || typeof p.id !== "string" || ids[p.id]) continue;
      if (typeof p.name !== "string" || !p.name.trim()) continue;
      ids[p.id] = true;
      players.push({
        id: p.id,
        name: p.name.trim().replace(/\s+/g, " ").slice(0, 24),
        color: /^#[0-9a-fA-F]{6}$/.test(p.color || "") ? p.color : "#e4b86a"
      });
    }
    if (players.length < 2) return null;
    var rounds = [];
    var roundSeen = {};
    for (i = 0; i < raw.rounds.length && rounds.length < 500; i++) {
      var round = sanitizeRound(raw.rounds[i], ids, roundSeen);
      if (round) rounds.push(round);
    }
    seen[raw.id] = true;
    return {
      id: raw.id,
      name: String(raw.name || "Buổi chơi").trim().slice(0, 40) || "Buổi chơi",
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : isoDate(new Date()),
      players: players,
      rounds: rounds,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
    };
  }

  function sanitizeRound(raw, ids, seen) {
    if (!raw || typeof raw.id !== "string" || seen[raw.id] || !Array.isArray(raw.entries)) return null;
    var entries = [];
    raw.entries.forEach(function (e) {
      if (!e || typeof e.t !== "string") return;
      if (e.t === "pay" && ids[e.from] && ids[e.to] && e.from !== e.to && isPosInt(e.amount)) {
        var clean = { t: "pay", from: e.from, to: e.to, amount: e.amount };
        if (typeof e.tag === "string" && e.tag.trim()) clean.tag = e.tag.trim().slice(0, 40);
        entries.push(clean);
      }
    });
    seen[raw.id] = true;
    var round = {
      id: raw.id,
      at: typeof raw.at === "string" ? raw.at : new Date().toISOString(),
      entries: entries
    };
    if (typeof raw.note === "string" && raw.note.trim()) round.note = raw.note.trim().slice(0, 80);
    return round;
  }

  function isoDate(d) {
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = "0" + m;
    if (day.length < 2) day = "0" + day;
    return d.getFullYear() + "-" + m + "-" + day;
  }

  return {
    uid: uid,
    isPosInt: isPosInt,
    formatPlain: formatPlain,
    formatMoney: formatMoney,
    formatSigned: formatSigned,
    formatK: formatK,
    formatSignedK: formatSignedK,
    parseK: parseK,
    kValue: kValue,
    rankName: rankName,
    planRound: planRound,
    netsFromEntries: netsFromEntries,
    netFromRounds: netFromRounds,
    simplifyNets: simplifyNets,
    sanitizeBundle: sanitizeBundle,
    isoDate: isoDate
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = GT;
  if (typeof window === "undefined") runTests();
}

function runTests() {
  function eq(actual, expected, label) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    if (a !== b) throw new Error(label + "\n  got  " + a + "\n  want " + b);
  }
  eq(GT.parseK("20").value, 20000, "20 -> 20k");
  eq(GT.parseK("2,5").value, 2500, "2,5 -> 2.5k");
  eq(GT.parseK("50000").value, 50000, "full amount kept");
  eq(GT.parseK("0").value, 0, "zero ok");
  eq(GT.parseK("").state, "empty", "empty");
  eq(GT.parseK("-5").state, "invalid", "sign is not typed");
  eq(GT.formatK(2500), "2,5k", "fmt 2,5k");
  eq(GT.formatK(1500000), "1,5tr", "fmt 1,5tr");
  eq(GT.formatSignedK(-10000), "−10k", "signed");

  var four = { players: [{ id: "a", name: "An" }, { id: "b", name: "Bình" }, { id: "c", name: "Chi" }, { id: "d", name: "Dũng" }] };
  function amt(v) { return { value: v, bad: false }; }

  eq(GT.planRound(four, { amounts: {} }).tone, "hint", "nothing typed");
  var off = GT.planRound(four, { amounts: { a: amt(30000), b: amt(-10000) } });
  eq([off.ok, off.message], [false, "Tổng đang +20k, phải bằng 0."], "two empty rows cannot balance");

  var auto = GT.planRound(four, { amounts: { b: amt(-10000), c: amt(-20000), d: amt(-5000) } });
  eq(auto.filled, { id: "a", amount: 35000 }, "auto fill last empty row");
  eq(auto.nets, { a: 35000, b: -10000, c: -20000, d: -5000 }, "auto nets");

  var exact = GT.planRound(four, { amounts: { a: amt(50000), b: amt(-30000), c: amt(-20000) } });
  eq([exact.ok, exact.filled, exact.nets.d], [true, null, 0], "balanced leaves empty as 0");
  eq(GT.netsFromEntries(exact.entries, ["a", "b", "c", "d"]), { a: 50000, b: -30000, c: -20000, d: 0 }, "entries reproduce nets");

  eq(GT.planRound(four, { amounts: { a: { value: null, bad: true } } }).message, "Số tiền của An chưa đúng.", "bad input");

  var nets = GT.netFromRounds(["a", "b", "c"], [
    { entries: [{ t: "pay", from: "b", to: "a", amount: 10000 }] },
    { entries: [{ t: "pay", from: "c", to: "a", amount: 10000 }] },
    { entries: [{ t: "pay", from: "a", to: "b", amount: 10000 }] }
  ]);
  eq(GT.simplifyNets(nets), [{ from: "c", to: "a", amount: 10000 }], "settle");

  var bundle = GT.sanitizeBundle({ v: 1, sessions: [{
    id: "s1", name: "Tối", date: "2026-11-09", game: "xidach",
    players: four.players.map(function (p) { return { id: p.id, name: p.name, color: "#112233" }; }),
    rounds: [{ id: "r1", at: "2026-11-09T12:00:00.000Z", note: " chặt heo ", entries: exact.entries.concat([{ t: "push", player: "a", other: "b" }]) }],
    updatedAt: "2026-11-09T12:00:00.000Z"
  }] });
  eq(bundle.sessions[0].rounds[0].note, "chặt heo", "note kept");
  eq(bundle.sessions[0].rounds[0].entries.length, exact.entries.length, "old push entries dropped");
  eq(GT.sanitizeBundle({ nope: true }), null, "reject junk");
  console.log("logic ok");
}
