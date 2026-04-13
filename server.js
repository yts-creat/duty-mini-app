const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Tesseract = require("tesseract.js");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "replace_this_in_production";
let DB_PATH =
  process.env.DB_PATH ||
  (IS_PROD ? "/tmp/db.json" : path.join(__dirname, "data", "db.json"));
const FALLBACK_DB_PATH = "/tmp/db.json";

const CHECK_WINDOW_MINUTES = 20;
const WEEKDAY_LABELS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const TEMPLATE_TIME_SLOTS = [
  { startTime: "08:00", endTime: "09:40" },
  { startTime: "10:00", endTime: "11:40" },
  { startTime: "14:00", endTime: "15:40" },
  { startTime: "16:00", endTime: "17:40" }
];
const NAME_STOPWORDS = new Set([
  "创业网",
  "第七周",
  "值班表",
  "时间",
  "电话",
  "号码",
  "电话号码",
  "上午",
  "下午",
  "部门",
  "周值班表",
  "值班",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
  ...WEEKDAY_LABELS
]);

if (IS_PROD && JWT_SECRET === "replace_this_in_production") {
  console.error("FATAL: JWT_SECRET is required in production.");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT_EXCEPTION]", error?.message || error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});

function ensureDbFile() {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      const initial = {
        users: [],
        dutySlots: [],
        checkins: [],
        currentSchedule: null
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), "utf8");
    }
  } catch (error) {
    if (IS_PROD && DB_PATH !== FALLBACK_DB_PATH) {
      DB_PATH = FALLBACK_DB_PATH;
      ensureDbFile();
      return;
    }
    throw error;
  }
}

function readDb() {
  const raw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
  const db = JSON.parse(raw);
  return {
    users: Array.isArray(db.users) ? db.users : [],
    dutySlots: Array.isArray(db.dutySlots) ? db.dutySlots : Array.isArray(db.schedules) ? db.schedules : [],
    checkins: Array.isArray(db.checkins) ? db.checkins : [],
    currentSchedule: db.currentSchedule || null
  };
}

function writeDb(db) {
  const payload = {
    users: db.users,
    dutySlots: db.dutySlots,
    checkins: db.checkins,
    currentSchedule: db.currentSchedule || null
  };
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    if (IS_PROD && DB_PATH !== FALLBACK_DB_PATH) {
      DB_PATH = FALLBACK_DB_PATH;
      ensureDbFile();
      fs.writeFileSync(DB_PATH, JSON.stringify(payload, null, 2), "utf8");
      return;
    }
    throw error;
  }
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidPhone(phone) {
  return /^1\d{10}$/.test(phone);
}

function isValidPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 6 &&
    password.length <= 32 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}

function normalizeTime(value) {
  const raw = String(value || "").trim().replace("：", ":");
  const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return "";
  return `${String(m[1]).padStart(2, "0")}:${m[2]}`;
}

function isValidTime(value) {
  return normalizeTime(value) !== "";
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [y, m, d] = value.split("-").map((n) => Number(n));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

function toPublicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    department: user.department,
    createdAt: user.createdAt
  };
}

function parseDateTimeAsCST(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-").map((n) => Number(n));
  const [hours, minutes] = timeStr.split(":").map((n) => Number(n));
  return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes, 0));
}

function formatDateTimeCN(isoOrDate) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return date.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map((n) => Number(n));
  const t = Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function getWeekdayLabel(index1to7) {
  return WEEKDAY_LABELS[index1to7 - 1] || "";
}

function createToken(user) {
  return jwt.sign(
    {
      uid: user.id,
      phone: user.phone,
      name: user.name,
      department: user.department
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return res.status(401).json({ message: "未登录或登录已过期" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = readDb();
    const user = db.users.find((u) => u.id === payload.uid);
    if (!user) {
      return res.status(401).json({ message: "用户不存在，请重新登录" });
    }
    req.user = user;
    next();
  } catch (_error) {
    return res.status(401).json({ message: "登录令牌无效，请重新登录" });
  }
}

function normalizeOcrText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/：/g, ":")
    .replace(/[—–－]/g, "-");
}

function weekdayIndexFromText(text) {
  const raw = normalizeOcrText(text);
  const m1 = raw.match(/星期([一二三四五六日天])/);
  if (m1) {
    return "一二三四五六日天".indexOf(m1[1]) + 1;
  }
  const m2 = raw.match(/周([一二三四五六日天])/);
  if (m2) {
    return "一二三四五六日天".indexOf(m2[1]) + 1;
  }
  return 0;
}

function allTimeTokensFromText(text) {
  const raw = String(text || "").replace(/：/g, ":");
  const result = [];
  const re = /([01]?\d|2[0-3]):([0-5]\d)/g;
  let m = null;
  while ((m = re.exec(raw)) !== null) {
    result.push(`${String(m[1]).padStart(2, "0")}:${m[2]}`);
  }
  return result;
}

function median(values) {
  if (!values.length) return 0;
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2) return arr[mid];
  return (arr[mid - 1] + arr[mid]) / 2;
}

function buildDayCenters(words) {
  const bucket = new Map();
  for (const w of words) {
    const idx = weekdayIndexFromText(w.text);
    if (!idx) continue;
    if (!bucket.has(idx)) bucket.set(idx, []);
    bucket.get(idx).push(w.cx);
  }

  const centers = new Array(7).fill(null);
  for (let i = 1; i <= 7; i += 1) {
    const values = bucket.get(i) || [];
    if (values.length) centers[i - 1] = median(values);
  }

  const known = centers
    .map((x, idx) => (x == null ? null : { idx, x }))
    .filter(Boolean);

  if (!known.length) return null;
  let avgGap = 120;
  if (known.length > 1) {
    const gaps = [];
    for (let i = 1; i < known.length; i += 1) {
      const di = known[i].idx - known[i - 1].idx;
      if (di > 0) gaps.push((known[i].x - known[i - 1].x) / di);
    }
    if (gaps.length) avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }

  for (let i = 0; i < 7; i += 1) {
    if (centers[i] != null) continue;
    let left = i - 1;
    while (left >= 0 && centers[left] == null) left -= 1;
    let right = i + 1;
    while (right < 7 && centers[right] == null) right += 1;
    if (left >= 0 && right < 7) {
      centers[i] =
        centers[left] +
        ((centers[right] - centers[left]) * (i - left)) / (right - left);
    } else if (left >= 0) {
      centers[i] = centers[left] + avgGap * (i - left);
    } else if (right < 7) {
      centers[i] = centers[right] - avgGap * (right - i);
    }
  }

  return centers;
}

function runKMeans1D(values, k, maxIter = 24) {
  if (!Array.isArray(values) || values.length < k || k <= 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  let centers = [];
  for (let i = 0; i < k; i += 1) {
    const idx = Math.floor((i * (sorted.length - 1)) / Math.max(k - 1, 1));
    centers.push(sorted[idx]);
  }

  for (let iter = 0; iter < maxIter; iter += 1) {
    const groups = Array.from({ length: k }, () => []);
    for (const v of sorted) {
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < k; i += 1) {
        const dist = Math.abs(v - centers[i]);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      groups[best].push(v);
    }
    const next = centers.map((c, i) => {
      const g = groups[i];
      if (!g.length) return c;
      return g.reduce((a, b) => a + b, 0) / g.length;
    });
    const moved = next.reduce((sum, c, i) => sum + Math.abs(c - centers[i]), 0);
    centers = next;
    if (moved < 1) break;
  }
  centers.sort((a, b) => a - b);
  return centers;
}

function buildDayCentersByNameWords(words) {
  const nameWords = words.filter((w) => extractName(w.text));
  if (nameWords.length < 7) return null;
  return runKMeans1D(
    nameWords.map((w) => w.cx),
    7
  );
}

function buildSlotStartYsByNameWords(words) {
  const nameWords = words.filter((w) => extractName(w.text));
  if (nameWords.length < 4) return null;
  return runKMeans1D(
    nameWords.map((w) => w.cy),
    4
  );
}

function buildDefaultDayCenters(words) {
  if (!words.length) return null;
  const minX = Math.min(...words.map((w) => w.x0));
  const maxX = Math.max(...words.map((w) => w.x1));
  const width = maxX - minX;
  if (width < 300) return null;

  const dayAreaLeft = minX + width * 0.22;
  const dayWidth = (maxX - dayAreaLeft) / 7;
  if (dayWidth <= 0) return null;

  return Array.from({ length: 7 }, (_v, i) => dayAreaLeft + dayWidth * (i + 0.5));
}

function buildDayBoundaries(centers) {
  if (!centers || centers.length !== 7) return null;
  const rows = [];
  for (let i = 0; i < 7; i += 1) {
    const current = centers[i];
    const prev = i > 0 ? centers[i - 1] : current - 120;
    const next = i < 6 ? centers[i + 1] : current + 120;
    rows.push({
      index: i + 1,
      label: getWeekdayLabel(i + 1),
      left: i > 0 ? (prev + current) / 2 : current - (next - current) / 2,
      right: i < 6 ? (current + next) / 2 : current + (current - prev) / 2
    });
  }
  return rows;
}

function buildSlotStartYs(words) {
  const byTime = new Map();
  for (const w of words) {
    const tokens = allTimeTokensFromText(w.text);
    for (const token of tokens) {
      if (!byTime.has(token)) byTime.set(token, []);
      byTime.get(token).push(w.cy);
    }
  }

  const ys = TEMPLATE_TIME_SLOTS.map((slot) => {
    const values = byTime.get(slot.startTime) || [];
    return values.length ? median(values) : null;
  });

  const known = ys
    .map((y, idx) => (y == null ? null : { idx, y }))
    .filter(Boolean);
  if (!known.length) return null;

  let avgGap = 170;
  if (known.length > 1) {
    const gaps = [];
    for (let i = 1; i < known.length; i += 1) {
      const di = known[i].idx - known[i - 1].idx;
      if (di > 0) gaps.push((known[i].y - known[i - 1].y) / di);
    }
    if (gaps.length) avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }

  for (let i = 0; i < ys.length; i += 1) {
    if (ys[i] != null) continue;
    let left = i - 1;
    while (left >= 0 && ys[left] == null) left -= 1;
    let right = i + 1;
    while (right < ys.length && ys[right] == null) right += 1;
    if (left >= 0 && right < ys.length) {
      ys[i] = ys[left] + ((ys[right] - ys[left]) * (i - left)) / (right - left);
    } else if (left >= 0) {
      ys[i] = ys[left] + avgGap * (i - left);
    } else if (right < ys.length) {
      ys[i] = ys[right] - avgGap * (right - i);
    }
  }

  return ys;
}

function buildFullWeekTemplate(weekStartDate, recognizedSlots) {
  const map = new Map();
  for (const slot of recognizedSlots || []) {
    const key = `${slot.weekday}|${slot.startTime}|${slot.endTime}`;
    const old = map.get(key);
    if (!old) {
      map.set(key, slot);
      continue;
    }
    const oldScore = Number(Boolean(old.name)) + Number(Boolean(old.phone));
    const newScore = Number(Boolean(slot.name)) + Number(Boolean(slot.phone));
    if (newScore > oldScore) {
      map.set(key, slot);
    }
  }

  const rows = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const ts of TEMPLATE_TIME_SLOTS) {
      const key = `${weekday}|${ts.startTime}|${ts.endTime}`;
      const picked = map.get(key);
      rows.push({
        weekday,
        weekdayLabel: getWeekdayLabel(weekday),
        date: addDays(weekStartDate, weekday - 1),
        startTime: ts.startTime,
        endTime: ts.endTime,
        name: picked?.name || "",
        phone: picked?.phone || "",
        department: picked?.department || ""
      });
    }
  }
  return rows;
}

function extractName(rawText) {
  const candidates = String(rawText || "").match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  const filtered = candidates.filter((item) => {
    const t = item.trim();
    if (t.length < 2) return false;
    if (NAME_STOPWORDS.has(t)) return false;
    if (/^星期[一二三四五六日天]$/.test(t)) return false;
    if (/^周[一二三四五六日天]$/.test(t)) return false;
    return true;
  });
  if (!filtered.length) return "";
  filtered.sort((a, b) => b.length - a.length);
  return filtered[0];
}

function extractPhone(rawText) {
  const text = String(rawText || "");
  const direct = text.match(/1\d{10}/);
  if (direct) return direct[0];
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11 && /^1\d{10}$/.test(digits)) return digits;
  if (digits.length > 11) {
    const tryMatch = digits.match(/1\d{10}/);
    if (tryMatch) return tryMatch[0];
  }
  return "";
}

function parseSlotsFromScreenshot(words, weekStartDate) {
  const validWords = words
    .map((word) => {
      const text = String(word.text || "").trim();
      const box = word.bbox || {};
      const x0 = Number(box.x0 || 0);
      const x1 = Number(box.x1 || 0);
      const y0 = Number(box.y0 || 0);
      const y1 = Number(box.y1 || 0);
      return {
        text,
        x0,
        x1,
        y0,
        y1,
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2
      };
    })
    .filter((w) => w.text);

  if (!validWords.length) {
    return buildFullWeekTemplate(weekStartDate, []);
  }

  const centers =
    buildDayCenters(validWords) ||
    buildDayCentersByNameWords(validWords) ||
    buildDefaultDayCenters(validWords);
  const boundaries = buildDayBoundaries(centers);
  const slotYs = buildSlotStartYs(validWords) || buildSlotStartYsByNameWords(validWords);

  if (!boundaries || !slotYs) {
    return buildFullWeekTemplate(weekStartDate, []);
  }

  const slots = [];
  for (let i = 0; i < TEMPLATE_TIME_SLOTS.length; i += 1) {
    const startY = slotYs[i];
    const prevY = i > 0 ? slotYs[i - 1] : startY - 180;
    const nextY = i < TEMPLATE_TIME_SLOTS.length - 1 ? slotYs[i + 1] : startY + (startY - prevY);
    const top = i > 0 ? (prevY + startY) / 2 : startY - (nextY - startY) * 0.35;
    const bottom =
      i < TEMPLATE_TIME_SLOTS.length - 1 ? (startY + nextY) / 2 : startY + (startY - prevY) * 0.65;
    const mid = top + (bottom - top) * 0.56;

    for (const day of boundaries) {
      const cellWords = validWords.filter(
        (w) => w.cx >= day.left && w.cx <= day.right && w.cy >= top && w.cy <= bottom
      );
      if (!cellWords.length) continue;
      const sorted = cellWords.sort((a, b) => (a.cy === b.cy ? a.cx - b.cx : a.cy - b.cy));
      const nameText = sorted
        .filter((w) => w.cy <= mid)
        .map((w) => w.text)
        .join("");
      const phoneText = sorted
        .filter((w) => w.cy > mid)
        .map((w) => w.text)
        .join("");

      const name = extractName(nameText);
      const phone = extractPhone(`${phoneText}${nameText}`);
      if (!name && !phone) continue;

      slots.push({
        weekday: day.index,
        weekdayLabel: day.label,
        date: addDays(weekStartDate, day.index - 1),
        startTime: TEMPLATE_TIME_SLOTS[i].startTime,
        endTime: TEMPLATE_TIME_SLOTS[i].endTime,
        name,
        phone,
        department: ""
      });
    }
  }

  const dedup = new Map();
  for (const slot of slots) {
    const key = `${slot.weekday}|${slot.startTime}|${slot.endTime}|${slot.name}|${slot.phone}`;
    if (!dedup.has(key)) dedup.set(key, slot);
  }
  return buildFullWeekTemplate(weekStartDate, Array.from(dedup.values()));
}

function getCheckinWindow(slot, type) {
  const pivot = parseDateTimeAsCST(slot.date, type === "in" ? slot.startTime : slot.endTime);
  const start = new Date(pivot.getTime() - CHECK_WINDOW_MINUTES * 60 * 1000);
  const end = new Date(pivot.getTime() + CHECK_WINDOW_MINUTES * 60 * 1000);
  return { start, end };
}

function findUserSlotForAction(db, user, slotId) {
  return db.dutySlots.find(
    (slot) =>
      slot.id === slotId &&
      (slot.phone === user.phone || (slot.name && slot.name === user.name))
  );
}

function getOrCreateCheckin(db, slot, user) {
  let record = db.checkins.find((item) => item.slotId === slot.id && item.phone === user.phone);
  if (record) return record;
  record = {
    id: crypto.randomUUID(),
    slotId: slot.id,
    userId: user.id,
    date: slot.date,
    name: slot.name || user.name,
    phone: user.phone,
    checkInAt: null,
    checkOutAt: null,
    inRemark: "",
    outRemark: "",
    overtimeStart: "",
    overtimeMinutes: 0,
    overtimeRemark: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.checkins.push(record);
  return record;
}

function buildPublicRows(db) {
  const usersByPhone = new Map(db.users.map((u) => [u.phone, u]));
  const checkinBySlot = new Map(db.checkins.map((c) => [c.slotId, c]));

  return db.dutySlots
    .slice()
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
    .map((slot) => {
      const checkin = checkinBySlot.get(slot.id) || null;
      const user = usersByPhone.get(slot.phone) || null;
      const status = checkin?.checkOutAt
        ? "已完成"
        : checkin?.checkInAt
          ? "已进站"
          : "未签到";
      return {
        slotId: slot.id,
        date: slot.date,
        weekday: getWeekdayLabel(slot.weekday),
        startTime: slot.startTime,
        endTime: slot.endTime,
        name: slot.name || user?.name || "",
        phone: slot.phone || "",
        department: slot.department || user?.department || "",
        status,
        checkInAt: checkin?.checkInAt || "",
        checkOutAt: checkin?.checkOutAt || "",
        inRemark: checkin?.inRemark || "",
        outRemark: checkin?.outRemark || "",
        overtimeStart: checkin?.overtimeStart || "",
        overtimeMinutes: Number(checkin?.overtimeMinutes || 0),
        overtimeRemark: checkin?.overtimeRemark || ""
      };
    });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.post("/api/auth/register", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  const name = String(req.body.name || "").trim();
  const department = String(req.body.department || "").trim();

  if (!isValidPhone(phone)) {
    return res.status(400).json({ message: "手机号格式不正确" });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ message: "密码需为6-32位且包含字母和数字" });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ message: "两次输入的密码不一致" });
  }
  if (!name) {
    return res.status(400).json({ message: "请输入姓名" });
  }
  if (!department) {
    return res.status(400).json({ message: "请选择部门" });
  }

  const db = readDb();
  if (db.users.some((u) => u.phone === phone)) {
    return res.status(409).json({ message: "该手机号已注册，请直接登录" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    phone,
    passwordHash,
    name,
    department,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDb(db);

  const token = createToken(user);
  return res.status(201).json({
    message: "注册成功",
    token,
    user: toPublicUser(user)
  });
});

app.post("/api/auth/login", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || "");

  if (!isValidPhone(phone)) {
    return res.status(400).json({ message: "手机号格式不正确" });
  }
  if (!password) {
    return res.status(400).json({ message: "请输入密码" });
  }

  const db = readDb();
  const user = db.users.find((u) => u.phone === phone);
  if (!user) {
    return res.status(401).json({ message: "手机号或密码错误" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "手机号或密码错误" });
  }

  const token = createToken(user);
  return res.json({
    message: "登录成功",
    token,
    user: toPublicUser(user)
  });
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

app.get("/api/schedule/current", authMiddleware, (_req, res) => {
  const db = readDb();
  res.json({
    currentSchedule: db.currentSchedule,
    totalSlots: db.dutySlots.length,
    totalCheckins: db.checkins.length
  });
});

app.post("/api/schedule/recognize", authMiddleware, async (req, res) => {
  const title = String(req.body.title || "值班表导入").trim();
  const weekStartDate = String(req.body.weekStartDate || "").trim();
  const imageDataUrl = String(req.body.imageDataUrl || "");

  if (!isValidDate(weekStartDate)) {
    return res.status(400).json({ message: "周起始日期格式错误，应为 YYYY-MM-DD" });
  }
  if (!/^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(imageDataUrl)) {
    return res.status(400).json({ message: "请上传有效的图片文件" });
  }

  let imageBuffer = null;
  try {
    imageBuffer = Buffer.from(imageDataUrl.split(",")[1], "base64");
  } catch (_error) {
    return res.status(400).json({ message: "图片编码格式不正确" });
  }
  if (!imageBuffer || !imageBuffer.length) {
    return res.status(400).json({ message: "图片内容为空" });
  }
  if (imageBuffer.length < 15 * 1024) {
    const slots = buildFullWeekTemplate(weekStartDate, []);
    return res.json({
      message: "图片过小或清晰度不足，已生成完整周模板，请按截图手工补充后导入",
      title,
      weekStartDate,
      weekEndDate: addDays(weekStartDate, 6),
      slots,
      rawTextPreview: ""
    });
  }

  try {
    const result = await Tesseract.recognize(imageBuffer, "chi_sim+eng");
    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    const slots = parseSlotsFromScreenshot(words, weekStartDate);
    const filledCount = slots.filter((s) => s.name || s.phone).length;
    return res.json({
      message:
        filledCount > 0
          ? `识别完成，自动填充 ${filledCount} 个班次，其余已生成空模板可手工补充`
          : "识别结果较弱，已生成完整周模板，请按截图手工补充后导入",
      title,
      weekStartDate,
      weekEndDate: addDays(weekStartDate, 6),
      slots,
      rawTextPreview: String(result?.data?.text || "").slice(0, 2000)
    });
  } catch (error) {
    console.error("[OCR_ERROR]", error.message);
    return res.status(500).json({ message: "值班表识别失败，请稍后重试或手动录入" });
  }
});

app.post("/api/schedule/import", authMiddleware, (req, res) => {
  const title = String(req.body.title || "值班表导入").trim();
  const weekStartDate = String(req.body.weekStartDate || "").trim();
  const incomingSlots = Array.isArray(req.body.slots) ? req.body.slots : [];

  if (!isValidDate(weekStartDate)) {
    return res.status(400).json({ message: "周起始日期格式错误，应为 YYYY-MM-DD" });
  }
  if (!incomingSlots.length) {
    return res.status(400).json({ message: "没有可导入的值班记录" });
  }

  const normalizedSlots = [];
  const dedup = new Set();
  for (const item of incomingSlots) {
    const weekday = Number(item.weekday);
    const startTime = normalizeTime(item.startTime);
    const endTime = normalizeTime(item.endTime);
    const name = String(item.name || "").trim();
    const phone = normalizePhone(item.phone);
    const department = String(item.department || "").trim();

    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
    if (!startTime || !endTime) continue;
    if (!name && !isValidPhone(phone)) continue;

    const key = `${weekday}|${startTime}|${endTime}|${name}|${phone}`;
    if (dedup.has(key)) continue;
    dedup.add(key);

    normalizedSlots.push({
      id: crypto.randomUUID(),
      weekday,
      date: addDays(weekStartDate, weekday - 1),
      startTime,
      endTime,
      name,
      phone: isValidPhone(phone) ? phone : "",
      department,
      createdAt: new Date().toISOString()
    });
  }

  if (!normalizedSlots.length) {
    return res.status(400).json({ message: "值班记录无效，请检查姓名/手机号/时间" });
  }

  const db = readDb();
  db.currentSchedule = {
    id: crypto.randomUUID(),
    title,
    weekStartDate,
    weekEndDate: addDays(weekStartDate, 6),
    importedAt: new Date().toISOString(),
    importedBy: req.user.phone
  };
  db.dutySlots = normalizedSlots;
  db.checkins = [];
  writeDb(db);

  return res.json({
    message: "值班表导入成功，已清空历史签到与加班数据",
    currentSchedule: db.currentSchedule,
    importedCount: normalizedSlots.length
  });
});

app.get("/api/my/slots", authMiddleware, (req, res) => {
  const db = readDb();
  const mine = db.dutySlots
    .filter(
      (slot) => slot.phone === req.user.phone || (slot.name && slot.name === req.user.name)
    )
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
    .map((slot) => {
      const checkin = db.checkins.find((item) => item.slotId === slot.id && item.phone === req.user.phone);
      const inWindow = getCheckinWindow(slot, "in");
      const outWindow = getCheckinWindow(slot, "out");
      return {
        ...slot,
        checkin: checkin || null,
        inWindowText: `${formatDateTimeCN(inWindow.start)} ~ ${formatDateTimeCN(inWindow.end)}`,
        outWindowText: `${formatDateTimeCN(outWindow.start)} ~ ${formatDateTimeCN(outWindow.end)}`
      };
    });

  return res.json({
    currentSchedule: db.currentSchedule,
    slots: mine
  });
});

app.post("/api/checkins/in", authMiddleware, (req, res) => {
  const slotId = String(req.body.slotId || "");
  const remark = String(req.body.remark || "").trim();
  if (!slotId) {
    return res.status(400).json({ message: "请选择值班记录" });
  }

  const db = readDb();
  const slot = findUserSlotForAction(db, req.user, slotId);
  if (!slot) {
    return res.status(404).json({ message: "未找到你本周对应的值班记录" });
  }

  const now = new Date();
  const window = getCheckinWindow(slot, "in");
  if (now < window.start || now > window.end) {
    return res.status(400).json({
      message: "进站签到不在允许时间范围内",
      allowedWindow: `${formatDateTimeCN(window.start)} ~ ${formatDateTimeCN(window.end)}`
    });
  }

  const record = getOrCreateCheckin(db, slot, req.user);
  if (record.checkInAt) {
    return res.status(409).json({ message: "该班次已经进站签到，无需重复操作" });
  }
  record.checkInAt = now.toISOString();
  record.inRemark = remark;
  record.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({ message: "进站签到成功", checkin: record });
});

app.post("/api/checkins/out", authMiddleware, (req, res) => {
  const slotId = String(req.body.slotId || "");
  const remark = String(req.body.remark || "").trim();
  if (!slotId) {
    return res.status(400).json({ message: "请选择值班记录" });
  }

  const db = readDb();
  const slot = findUserSlotForAction(db, req.user, slotId);
  if (!slot) {
    return res.status(404).json({ message: "未找到你本周对应的值班记录" });
  }

  const now = new Date();
  const window = getCheckinWindow(slot, "out");
  if (now < window.start || now > window.end) {
    return res.status(400).json({
      message: "出站签到不在允许时间范围内",
      allowedWindow: `${formatDateTimeCN(window.start)} ~ ${formatDateTimeCN(window.end)}`
    });
  }

  const record = getOrCreateCheckin(db, slot, req.user);
  if (!record.checkInAt) {
    return res.status(400).json({ message: "请先完成进站签到" });
  }
  if (record.checkOutAt) {
    return res.status(409).json({ message: "该班次已经出站签到，无需重复操作" });
  }
  record.checkOutAt = now.toISOString();
  record.outRemark = remark;
  record.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({ message: "出站签到成功", checkin: record });
});

app.post("/api/checkins/overtime", authMiddleware, (req, res) => {
  const slotId = String(req.body.slotId || "");
  const overtimeStart = normalizeTime(req.body.overtimeStart || "");
  const overtimeMinutes = Number(req.body.overtimeMinutes || 0);
  const overtimeRemark = String(req.body.overtimeRemark || "").trim();

  if (!slotId) {
    return res.status(400).json({ message: "请选择值班记录" });
  }
  if (!overtimeStart) {
    return res.status(400).json({ message: "请填写加班开始时间（HH:mm）" });
  }
  if (!Number.isInteger(overtimeMinutes) || overtimeMinutes <= 0 || overtimeMinutes > 720) {
    return res.status(400).json({ message: "加班时长请填写 1-720 分钟整数" });
  }

  const db = readDb();
  const slot = findUserSlotForAction(db, req.user, slotId);
  if (!slot) {
    return res.status(404).json({ message: "未找到你本周对应的值班记录" });
  }

  const record = getOrCreateCheckin(db, slot, req.user);
  record.overtimeStart = overtimeStart;
  record.overtimeMinutes = overtimeMinutes;
  record.overtimeRemark = overtimeRemark;
  record.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({ message: "加班信息已保存", checkin: record });
});

app.get("/api/public/overview", (_req, res) => {
  const db = readDb();
  const rows = buildPublicRows(db);
  return res.json({
    currentSchedule: db.currentSchedule,
    rows
  });
});

app.get("/api/public/export.csv", (_req, res) => {
  const db = readDb();
  const rows = buildPublicRows(db);
  let csv = "\uFEFF";
  csv += "日期,星期,班次,姓名,手机号,部门,签到状态,进站时间,出站时间,工作备注,出站备注,加班开始,加班时长(分钟),加班备注\n";
  for (const row of rows) {
    const line = [
      row.date,
      row.weekday,
      `${row.startTime}-${row.endTime}`,
      row.name,
      row.phone,
      row.department,
      row.status,
      row.checkInAt ? formatDateTimeCN(row.checkInAt) : "",
      row.checkOutAt ? formatDateTimeCN(row.checkOutAt) : "",
      row.inRemark,
      row.outRemark,
      row.overtimeStart,
      row.overtimeMinutes || "",
      row.overtimeRemark
    ]
      .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
      .join(",");
    csv += `${line}\n`;
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''attendance_public_${fileDate}.csv`
  );
  return res.send(csv);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureDbFile();
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DB_PATH=${DB_PATH}`);
});
