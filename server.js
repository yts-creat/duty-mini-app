const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PDFParse } = require("pdf-parse");
const Tesseract = require("tesseract.js");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "replace_this_in_production";
const ADMIN_ACCOUNT = process.env.ADMIN_ACCOUNT || "\u7ba1\u7406\u5458";
const ADMIN_NAME = "\u7cfb\u7edf\u7ba1\u7406\u5458";
const ADMIN_DEPARTMENT = "\u7ba1\u7406\u5458";
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "Admin12345";
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
const EMPTY_DUTY_MARKERS = new Set(["空", "无", "无人", "休", "休息", "-", "—", "--", "暂无", "空班"]);

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
        overtimeEntries: [],
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
  const normalized = {
    users: Array.isArray(db.users) ? db.users : [],
    dutySlots: Array.isArray(db.dutySlots) ? db.dutySlots : Array.isArray(db.schedules) ? db.schedules : [],
    checkins: Array.isArray(db.checkins) ? db.checkins : [],
    overtimeEntries: Array.isArray(db.overtimeEntries) ? db.overtimeEntries : [],
    currentSchedule: db.currentSchedule || null
  };
  if (ensureBuiltinAdmin(normalized)) {
    writeDb(normalized);
  }
  return normalized;
}

function writeDb(db) {
  const payload = {
    users: db.users,
    dutySlots: db.dutySlots,
    checkins: db.checkins,
    overtimeEntries: db.overtimeEntries,
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

function diffMinutesBetweenTimes(startTime, endTime) {
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
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

function normalizeUserRecord(user) {
  const createdAt = user.createdAt || new Date().toISOString();
  const phone = normalizePhone(user.phone);
  const role = user.role === "admin" ? "admin" : "member";
  const loginAccount = role === "admin"
    ? ADMIN_ACCOUNT
    : (String(user.loginAccount || phone).trim() || phone);

  return {
    ...user,
    id: user.id || crypto.randomUUID(),
    phone,
    name: role === "admin" ? ADMIN_NAME : String(user.name || "").trim(),
    department: role === "admin" ? ADMIN_DEPARTMENT : String(user.department || "").trim(),
    role,
    loginAccount,
    avatarDataUrl: typeof user.avatarDataUrl === "string" ? user.avatarDataUrl : "",
    createdAt,
    updatedAt: user.updatedAt || createdAt
  };
}

function ensureBuiltinAdmin(db) {
  let changed = false;
  const normalizedUsers = (Array.isArray(db.users) ? db.users : []).map((user) => {
    const normalized = normalizeUserRecord(user);
    const keys = ["phone", "name", "department", "role", "loginAccount", "avatarDataUrl", "updatedAt"];
    if (keys.some((key) => normalized[key] !== user[key])) {
      changed = true;
    }
    return normalized;
  });

  if (!normalizedUsers.some((user) => user.role === "admin")) {
    normalizedUsers.unshift({
      id: crypto.randomUUID(),
      phone: "",
      passwordHash: bcrypt.hashSync(ADMIN_DEFAULT_PASSWORD, 10),
      name: ADMIN_NAME,
      department: ADMIN_DEPARTMENT,
      role: "admin",
      loginAccount: ADMIN_ACCOUNT,
      avatarDataUrl: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    changed = true;
  }

  db.users = normalizedUsers;
  return changed;
}

function toPublicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    loginAccount: user.loginAccount || user.phone,
    name: user.name,
    department: user.department,
    role: user.role === "admin" ? "admin" : "member",
    avatarDataUrl: user.avatarDataUrl || "",
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
      department: user.department,
      role: user.role,
      loginAccount: user.loginAccount || user.phone
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

function adminOnlyMiddleware(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "仅管理员可以导入和识别值班表" });
  }
  next();
}

function findUserByAccount(db, rawAccount) {
  const account = String(rawAccount || "").trim();
  if (!account) return null;
  const phone = normalizePhone(account);
  return (
    db.users.find((user) => user.loginAccount === account) ||
    (isValidPhone(phone) ? db.users.find((user) => user.phone === phone) : null)
  );
}

function normalizeOcrText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[\uFF1A\uFE55]/g, ":")
    .replace(/[\u2014\u2013\uFF0D]/g, "-");
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
  const raw = normalizeOcrText(text).replace(/[.\u3002]/g, ":");
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getWordBounds(words) {
  if (!Array.isArray(words) || !words.length) return null;
  const minX = Math.min(...words.map((w) => w.x0));
  const maxX = Math.max(...words.map((w) => w.x1));
  const minY = Math.min(...words.map((w) => w.y0));
  const maxY = Math.max(...words.map((w) => w.y1));
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1)
  };
}

function filterDayAreaWords(words) {
  const bounds = getWordBounds(words);
  if (!bounds) return [];
  const leftCutoff = bounds.minX + bounds.width * 0.18;
  return words.filter((w) => w.cx >= leftCutoff);
}

function filterDutyBodyWords(words) {
  const bounds = getWordBounds(words);
  if (!bounds) return [];
  const leftCutoff = bounds.minX + bounds.width * 0.18;
  const topCutoff = bounds.minY + bounds.height * 0.14;
  return words.filter((w) => w.cx >= leftCutoff && w.cy >= topCutoff);
}

function isLikelyPhoneChunk(text) {
  const raw = normalizeOcrText(text);
  if (!raw) return false;
  if (allTimeTokensFromText(raw).length) return false;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 11) return false;
  if (/^(19|20)\d{2}$/.test(digits)) return false;
  return true;
}

function expandCentersTo7(seedCenters, words) {
  if (!seedCenters || !seedCenters.length || !words.length) return null;
  let centers = seedCenters.slice().sort((a, b) => a - b);

  const minX = Math.min(...words.map((w) => w.x0));
  const maxX = Math.max(...words.map((w) => w.x1));
  const baseWidth = Math.max(maxX - minX, 1);

  while (centers.length < 7) {
    const gaps = [];
    for (let i = 1; i < centers.length; i += 1) {
      const gap = centers[i] - centers[i - 1];
      if (gap > 1) gaps.push(gap);
    }
    const typicalGap = median(gaps) || baseWidth / 8;

    let inserted = false;
    let widestGap = -1;
    let widestIdx = -1;
    for (let i = 1; i < centers.length; i += 1) {
      const gap = centers[i] - centers[i - 1];
      if (gap > widestGap) {
        widestGap = gap;
        widestIdx = i - 1;
      }
    }
    if (widestIdx >= 0 && widestGap > typicalGap * 1.45) {
      centers.splice(widestIdx + 1, 0, (centers[widestIdx] + centers[widestIdx + 1]) / 2);
      inserted = true;
    }

    if (!inserted) {
      const leftMargin = centers[0] - minX;
      const rightMargin = maxX - centers[centers.length - 1];
      if (leftMargin > rightMargin + typicalGap * 0.35) {
        centers.unshift(centers[0] - typicalGap);
      } else if (rightMargin > leftMargin + typicalGap * 0.35) {
        centers.push(centers[centers.length - 1] + typicalGap);
      } else {
        const prepend = centers[0] - typicalGap;
        const append = centers[centers.length - 1] + typicalGap;
        const prependCost = Math.abs(prepend - minX);
        const appendCost = Math.abs(maxX - append);
        if (prependCost <= appendCost) {
          centers.unshift(prepend);
        } else {
          centers.push(append);
        }
      }
    }
  }

  if (centers.length > 7) {
    const reduced = [];
    for (let i = 0; i < 7; i += 1) {
      const idx = Math.round((i * (centers.length - 1)) / 6);
      reduced.push(centers[idx]);
    }
    centers = reduced;
  }
  return centers.slice(0, 7);
}

function buildDayCentersByNameWords(words) {
  const nameWords = filterDayAreaWords(words).filter((w) => extractName(w.text));
  if (nameWords.length < 5) return null;
  const values = nameWords.map((w) => w.cx);
  for (const k of [7, 6, 5]) {
    if (values.length < k) continue;
    const centers = runKMeans1D(values, k);
    const expanded = expandCentersTo7(centers, words);
    if (expanded) return expanded;
  }
  return null;
}

function buildDayCentersByDutyWords(words) {
  const dutyWords = filterDayAreaWords(words).filter(
    (w) => extractName(w.text) || isLikelyPhoneChunk(w.text)
  );
  if (dutyWords.length < 10) return null;
  const values = dutyWords.map((w) => w.cx);
  for (const k of [7, 6, 5]) {
    if (values.length < k) continue;
    const centers = runKMeans1D(values, k);
    const expanded = expandCentersTo7(centers, words);
    if (expanded) return expanded;
  }
  return null;
}

function buildSlotStartYsByNameWords(words) {
  const nameWords = filterDutyBodyWords(words).filter((w) => extractName(w.text));
  if (nameWords.length < 4) return null;
  return runKMeans1D(
    nameWords.map((w) => w.cy),
    4
  );
}

function buildSlotStartYsByPhoneWords(words) {
  const phoneWords = filterDutyBodyWords(words).filter((w) => isLikelyPhoneChunk(w.text));
  if (phoneWords.length < 8) return null;
  return runKMeans1D(
    phoneWords.map((w) => w.cy),
    4
  );
}

function buildDefaultSlotStartYs(words) {
  if (!words.length) return null;
  const minY = Math.min(...words.map((w) => w.y0));
  const maxY = Math.max(...words.map((w) => w.y1));
  const height = maxY - minY;
  if (height < 300) return null;

  const tableTop = minY + height * 0.18;
  const tableBottom = minY + height * 0.92;
  const step = (tableBottom - tableTop) / 4;
  if (step <= 0) return null;

  return Array.from({ length: 4 }, (_v, idx) => tableTop + step * (idx + 0.5));
}

function buildDefaultDayCenters(words) {
  const bounds = getWordBounds(words);
  if (!bounds || bounds.width < 300) return null;

  const timeWords = words.filter((w) => allTimeTokensFromText(w.text).length > 0);
  const estimatedLeftByTime = timeWords.length
    ? Math.max(...timeWords.map((w) => w.x1)) + bounds.width * 0.02
    : bounds.minX + bounds.width * 0.18;
  const dayAreaLeft = clamp(
    estimatedLeftByTime,
    bounds.minX + bounds.width * 0.14,
    bounds.minX + bounds.width * 0.42
  );
  const dayWidth = (bounds.maxX - dayAreaLeft) / 7;
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

function collectSeriesCandidates(seriesList, expectedLength) {
  const seen = new Set();
  const result = [];
  for (const series of seriesList) {
    if (!Array.isArray(series) || series.length !== expectedLength) continue;
    if (series.some((v) => !Number.isFinite(v))) continue;
    const sorted = series.slice().sort((a, b) => a - b);
    const key = sorted.map((v) => Math.round(v * 10) / 10).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(sorted);
  }
  return result;
}

function extractSlotsByLayout(validWords, weekStartDate, boundaries, slotYs) {
  const slots = [];
  for (let i = 0; i < TEMPLATE_TIME_SLOTS.length; i += 1) {
    const startY = slotYs[i];
    const prevY = i > 0 ? slotYs[i - 1] : startY - 180;
    const nextY = i < TEMPLATE_TIME_SLOTS.length - 1 ? slotYs[i + 1] : startY + (startY - prevY);
    const top = i > 0 ? (prevY + startY) / 2 : startY - (nextY - startY) * 0.35;
    const bottom =
      i < TEMPLATE_TIME_SLOTS.length - 1 ? (startY + nextY) / 2 : startY + (startY - prevY) * 0.65;
    const mid = (top + bottom) / 2;

    for (const day of boundaries) {
      const cellWords = validWords.filter(
        (w) => w.cx >= day.left && w.cx <= day.right && w.cy >= top && w.cy <= bottom
      );
      if (!cellWords.length) continue;
      const sorted = cellWords.sort((a, b) => (a.cy === b.cy ? a.cx - b.cx : a.cy - b.cy));
      const fullCellText = sorted.map((w) => w.text).join("");
      const nameText = sorted
        .filter((w) => w.cy <= mid)
        .map((w) => w.text)
        .join("");
      const phoneText = sorted
        .filter((w) => w.cy > mid)
        .map((w) => w.text)
        .join("");

      const name = normalizeDutyName(extractName(nameText || fullCellText));
      const phone = extractPhone(`${phoneText}${fullCellText}`);
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
  return Array.from(dedup.values());
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
    const pickedPhone = isValidPhone(old.phone || "")
      ? old.phone
      : isValidPhone(slot.phone || "")
        ? slot.phone
        : old.phone || slot.phone || "";
    map.set(key, {
      ...old,
      ...slot,
      name: old.name || slot.name || "",
      phone: pickedPhone,
      department: old.department || slot.department || ""
    });
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
    if (EMPTY_DUTY_MARKERS.has(t)) return false;
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
  const text = normalizeOcrText(rawText);
  const direct = text.match(/1\d{10}/);
  if (direct) return direct[0];
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11 && /^1\d{10}$/.test(digits)) return digits;
  if (digits.length >= 11) {
    for (let i = 0; i <= digits.length - 11; i += 1) {
      const piece = digits.slice(i, i + 11);
      if (/^1[3-9]\d{9}$/.test(piece)) return piece;
    }
    const tryMatch = digits.match(/1[3-9]\d{9}/);
    if (tryMatch) return tryMatch[0];
  }
  return "";
}

function normalizeDutyName(value) {
  const name = String(value || "").trim();
  const compact = name.replace(/\s+/g, "");
  if (!compact) return "";
  if (compact.length <= 1) return "";
  if (EMPTY_DUTY_MARKERS.has(compact)) return "";
  if (/^(空班|无人值班|无值班|未排班|待定|none|null|n\/a)$/iu.test(compact)) return "";
  if (/^[\-—_]+$/u.test(compact)) return "";
  return compact;
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

  const dayCenterCandidates = collectSeriesCandidates(
    [
      buildDayCenters(validWords),
      buildDayCentersByNameWords(validWords),
      buildDayCentersByDutyWords(validWords),
      buildDefaultDayCenters(validWords)
    ],
    7
  );
  const slotYCandidates = collectSeriesCandidates(
    [
      buildSlotStartYs(validWords),
      buildSlotStartYsByNameWords(validWords),
      buildSlotStartYsByPhoneWords(validWords),
      buildDefaultSlotStartYs(validWords)
    ],
    TEMPLATE_TIME_SLOTS.length
  );

  if (!dayCenterCandidates.length || !slotYCandidates.length) {
    return buildFullWeekTemplate(weekStartDate, []);
  }

  let bestSlots = [];
  let bestScore = -1;
  for (const centers of dayCenterCandidates) {
    const boundaries = buildDayBoundaries(centers);
    if (!boundaries) continue;
    for (const slotYs of slotYCandidates) {
      const slots = extractSlotsByLayout(validWords, weekStartDate, boundaries, slotYs);
      const score = scoreRecognizedSlots(slots);
      if (score > bestScore || (score === bestScore && slots.length > bestSlots.length)) {
        bestScore = score;
        bestSlots = slots;
      }
    }
  }

  return buildFullWeekTemplate(weekStartDate, bestSlots);
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

function buildOvertimeRows(db, phoneFilter = "") {
  const rows = (db.overtimeEntries || [])
    .filter((item) => !phoneFilter || item.phone === phoneFilter)
    .slice()
    .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`))
    .map((item) => ({
      id: item.id,
      userId: item.userId || "",
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      overtimeMinutes: Number(item.overtimeMinutes || 0),
      name: item.name || "",
      phone: item.phone || "",
      department: item.department || "",
      remark: item.remark || "",
      createdAt: item.createdAt || ""
    }));
  return rows;
}

function scoreRecognizedSlots(slots) {
  return (slots || []).reduce((score, slot) => {
    const hasName = Boolean(slot?.name);
    const hasPhone = Boolean(slot?.phone);
    if (hasName && hasPhone) return score + 2;
    if (hasName || hasPhone) return score + 1;
    return score;
  }, 0);
}

function extractTimeRangeFromCell(text) {
  const tokens = allTimeTokensFromText(text);
  if (tokens.length < 2) return null;
  const startTime = normalizeTime(tokens[0]);
  const endTime = normalizeTime(tokens[1]);
  if (!startTime || !endTime) return null;
  return { startTime, endTime };
}

function parseRecognizedSlotsFromPdfTable(table, weekStartDate) {
  if (!Array.isArray(table) || !table.length) return [];

  const recognizedSlots = [];
  for (let i = 0; i < table.length; i += 1) {
    const row = Array.isArray(table[i]) ? table[i].map((cell) => String(cell || "").trim()) : [];
    const dayStartIndex = row.length - 7;
    if (dayStartIndex < 1) continue;

    const timeRange = extractTimeRangeFromCell(row[dayStartIndex - 1] || "");
    if (!timeRange) continue;

    const nameCells = row.slice(dayStartIndex, dayStartIndex + 7);
    let phoneCells = new Array(7).fill("");

    const nextRow = Array.isArray(table[i + 1]) ? table[i + 1].map((cell) => String(cell || "").trim()) : [];
    const nextDayStartIndex = nextRow.length - 7;
    const nextLabel = nextRow.slice(0, Math.max(nextDayStartIndex, 1)).join("");
    if (nextDayStartIndex >= 1 && /电话|号码/.test(nextLabel)) {
      phoneCells = nextRow.slice(nextDayStartIndex, nextDayStartIndex + 7);
      i += 1;
    }

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const rawName = nameCells[dayIndex] || "";
      const rawPhone = phoneCells[dayIndex] || "";
      const name = normalizeDutyName(extractName(rawName) || rawName);
      const phone = extractPhone(rawPhone);
      if (!name && !phone) continue;

      recognizedSlots.push({
        weekday: dayIndex + 1,
        weekdayLabel: getWeekdayLabel(dayIndex + 1),
        date: addDays(weekStartDate, dayIndex),
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
        name,
        phone,
        department: ""
      });
    }
  }

  return recognizedSlots;
}

async function recognizeScheduleFromPdfBuffer(pdfBuffer, weekStartDate) {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const tableResult = await parser.getTable();
    const textResult = await parser.getText();
    const tables = [];
    for (const page of tableResult?.pages || []) {
      for (const table of page?.tables || []) {
        tables.push(table);
      }
    }

    let bestSlots = [];
    let bestScore = -1;
    for (const table of tables) {
      const slots = parseRecognizedSlotsFromPdfTable(table, weekStartDate);
      const score = scoreRecognizedSlots(slots);
      if (score > bestScore || (score === bestScore && slots.length > bestSlots.length)) {
        bestScore = score;
        bestSlots = slots;
      }
    }

    const mergedSlots = buildFullWeekTemplate(weekStartDate, bestSlots);
    return {
      slots: mergedSlots,
      score: scoreRecognizedSlots(bestSlots),
      filledCount: mergedSlots.filter((slot) => slot.name || slot.phone).length,
      rawTextPreview: String(textResult?.text || "").slice(0, 2000)
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function recognizeScheduleByMultiPass(imageBuffer, weekStartDate) {
  const modes = [Tesseract.PSM.AUTO, Tesseract.PSM.SPARSE_TEXT];
  let best = null;

  for (const mode of modes) {
    let result = null;
    try {
      result = await Tesseract.recognize(imageBuffer, "chi_sim+eng", {
        tessedit_pageseg_mode: mode
      });
    } catch (error) {
      console.error("[OCR_PASS_ERROR]", error?.message || error);
      continue;
    }

    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    const slots = parseSlotsFromScreenshot(words, weekStartDate);
    const score = scoreRecognizedSlots(slots);
    const filledCount = slots.filter((s) => s.name || s.phone).length;
    const rawTextPreview = String(result?.data?.text || "").slice(0, 2000);
    const candidate = { slots, score, filledCount, rawTextPreview };
    if (!best || candidate.score > best.score) best = candidate;
    if (candidate.filledCount >= 16) break;
  }

  if (best) return best;
  return {
    slots: buildFullWeekTemplate(weekStartDate, []),
    score: 0,
    filledCount: 0,
    rawTextPreview: ""
  };
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
    role: "member",
    loginAccount: phone,
    avatarDataUrl: "",
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
  const account = String(req.body.account || req.body.phone || "").trim();
  const password = String(req.body.password || "");

  if (!account) {
    return res.status(400).json({ message: "请输入账号" });
  }
  if (!password) {
    return res.status(400).json({ message: "请输入密码" });
  }

  const db = readDb();
  const user = findUserByAccount(db, account);
  if (!user) {
    return res.status(401).json({ message: "账号或密码错误" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "账号或密码错误" });
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

app.post("/api/auth/change-password", authMiddleware, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (!currentPassword) {
    return res.status(400).json({ message: "请输入当前密码" });
  }
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ message: "新密码需为6-32位且包含字母和数字" });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "两次输入的新密码不一致" });
  }

  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "用户不存在，请重新登录" });
  }

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(400).json({ message: "当前密码不正确" });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({ message: "密码修改成功", user: toPublicUser(user) });
});

app.post("/api/me/avatar", authMiddleware, (req, res) => {
  const avatarDataUrl = String(req.body.avatarDataUrl || "").trim();
  if (!avatarDataUrl) {
    return res.status(400).json({ message: "请上传头像图片" });
  }
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(avatarDataUrl)) {
    return res.status(400).json({ message: "头像格式仅支持 PNG、JPG、WEBP" });
  }

  let fileBuffer = null;
  try {
    fileBuffer = Buffer.from(avatarDataUrl.split(",")[1], "base64");
  } catch (_error) {
    return res.status(400).json({ message: "头像编码格式不正确" });
  }
  if (!fileBuffer?.length || fileBuffer.length > 350 * 1024) {
    return res.status(400).json({ message: "头像请控制在 350KB 以内" });
  }

  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "用户不存在，请重新登录" });
  }

  user.avatarDataUrl = avatarDataUrl;
  user.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({ message: "头像更新成功", user: toPublicUser(user) });
});

app.delete("/api/me/avatar", authMiddleware, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "用户不存在，请重新登录" });
  }

  user.avatarDataUrl = "";
  user.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({ message: "头像已移除", user: toPublicUser(user) });
});

app.get("/api/schedule/current", authMiddleware, (_req, res) => {
  const db = readDb();
  res.json({
    currentSchedule: db.currentSchedule,
    totalSlots: db.dutySlots.length,
    totalCheckins: db.checkins.length
  });
});

app.post("/api/schedule/recognize", authMiddleware, adminOnlyMiddleware, async (req, res) => {
  const title = String(req.body.title || "值班表导入").trim();
  const weekStartDate = String(req.body.weekStartDate || "").trim();
  const fileDataUrl = String(req.body.fileDataUrl || req.body.imageDataUrl || "");

  if (!isValidDate(weekStartDate)) {
    return res.status(400).json({ message: "周起始日期格式错误，应为 YYYY-MM-DD" });
  }
  if (!/^data:(application\/pdf|image\/[a-zA-Z0-9+.-]+);base64,/.test(fileDataUrl)) {
    return res.status(400).json({ message: "请上传有效的图片文件" });
  }

  const mimeType = fileDataUrl.slice(5, fileDataUrl.indexOf(";")).toLowerCase();
  let fileBuffer = null;
  try {
    fileBuffer = Buffer.from(fileDataUrl.split(",")[1], "base64");
  } catch (_error) {
    return res.status(400).json({ message: "图片编码格式不正确" });
  }
  if (!fileBuffer || !fileBuffer.length) {
    return res.status(400).json({ message: "图片内容为空" });
  }
  if (mimeType !== "application/pdf" && fileBuffer.length < 15 * 1024) {
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
    const recognized =
      mimeType === "application/pdf"
        ? await recognizeScheduleFromPdfBuffer(fileBuffer, weekStartDate)
        : await recognizeScheduleByMultiPass(fileBuffer, weekStartDate);
    const slots = recognized.slots || [];
    const filledCount = Number(recognized.filledCount || 0);
    return res.json({
      message:
        filledCount > 0
          ? `识别完成，自动填充 ${filledCount} 个班次，其余已生成空模板可手工补充`
          : "识别结果较弱，已生成完整周模板，请按截图手工补充后导入",
      title,
      weekStartDate,
      weekEndDate: addDays(weekStartDate, 6),
      slots,
      rawTextPreview: recognized.rawTextPreview || ""
    });
  } catch (error) {
    console.error("[OCR_ERROR]", error.message);
    return res.status(500).json({ message: "值班表识别失败，请稍后重试或手动录入" });
  }
});

app.post("/api/schedule/import", authMiddleware, adminOnlyMiddleware, (req, res) => {
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
    const name = normalizeDutyName(item.name);
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
    importedBy: req.user.loginAccount || req.user.phone || req.user.name
  };
  db.dutySlots = normalizedSlots;
  db.checkins = [];
  db.overtimeEntries = [];
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

app.get("/api/my/overtime", authMiddleware, (req, res) => {
  const db = readDb();
  return res.json({
    currentSchedule: db.currentSchedule,
    rows: buildOvertimeRows(db).filter((row) =>
      row.userId ? row.userId === req.user.id : row.phone === req.user.phone
    )
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

app.post("/api/overtime", authMiddleware, (req, res) => {
  const date = String(req.body.date || "").trim();
  const startTime = normalizeTime(req.body.startTime || "");
  const endTime = normalizeTime(req.body.endTime || "");
  const remark = String(req.body.remark || "").trim();

  if (!isValidDate(date)) {
    return res.status(400).json({ message: "请选择正确的加班日期" });
  }
  if (!startTime || !endTime) {
    return res.status(400).json({ message: "请选择加班开始和结束时间" });
  }

  const overtimeMinutes = diffMinutesBetweenTimes(startTime, endTime);
  if (!Number.isInteger(overtimeMinutes) || overtimeMinutes <= 0 || overtimeMinutes > 720) {
    return res.status(400).json({ message: "加班时长需要在 1-720 分钟之间，且结束时间要晚于开始时间" });
  }

  const db = readDb();
  const entry = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    name: req.user.name,
    phone: req.user.phone,
    department: req.user.department || "",
    date,
    startTime,
    endTime,
    overtimeMinutes,
    remark,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.overtimeEntries.push(entry);
  writeDb(db);

  return res.json({ message: "加班记录已保存", entry });
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
  const overtimeRows = buildOvertimeRows(db);
  return res.json({
    currentSchedule: db.currentSchedule,
    rows,
    overtimeRows
  });
});

function escapeCsvCell(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function sendDutyExportCsv(res, rows) {
  let csv = "\uFEFF";
  csv += "日期,星期,班次,姓名,手机号,部门,签到状态,进站时间,出站时间,进站备注,出站备注\n";
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
      row.outRemark
    ]
      .map(escapeCsvCell)
      .join(",");
    csv += `${line}\n`;
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''duty_attendance_${fileDate}.csv`
  );
  return res.send(csv);
}

function sendOvertimeExportCsv(res, rows) {
  let csv = "\uFEFF";
  csv += "日期,开始时间,结束时间,加班时长(分钟),姓名,手机号,部门,加班备注,创建时间\n";
  for (const row of rows) {
    const line = [
      row.date,
      row.startTime,
      row.endTime,
      row.overtimeMinutes,
      row.name,
      row.phone,
      row.department,
      row.remark,
      row.createdAt ? formatDateTimeCN(row.createdAt) : ""
    ]
      .map(escapeCsvCell)
      .join(",");
    csv += `${line}\n`;
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''overtime_attendance_${fileDate}.csv`
  );
  return res.send(csv);
}

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

app.get("/api/public/export-duty.csv", (_req, res) => {
  const db = readDb();
  return sendDutyExportCsv(res, buildPublicRows(db));
});

app.get("/api/public/export-overtime.csv", (_req, res) => {
  const db = readDb();
  return sendOvertimeExportCsv(res, buildOvertimeRows(db));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureDbFile();
readDb();
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DB_PATH=${DB_PATH}`);
});
