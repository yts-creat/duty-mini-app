const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace_this_in_production";
const IS_PROD = process.env.NODE_ENV === "production";
let DB_PATH =
  process.env.DB_PATH ||
  (IS_PROD ? "/tmp/db.json" : path.join(__dirname, "data", "db.json"));
const FALLBACK_DB_PATH = "/tmp/db.json";

if (IS_PROD && JWT_SECRET === "replace_this_in_production") {
  console.error("FATAL: JWT_SECRET is required in production environment.");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function ensureDbFile() {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH)) {
      const initData = {
        users: [],
        smsCodes: [],
        schedules: [],
        checkins: []
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(initData, null, 2), "utf8");
    }
  } catch (error) {
    if (IS_PROD && DB_PATH !== FALLBACK_DB_PATH) {
      console.warn(`DB path '${DB_PATH}' is not writable, fallback to '${FALLBACK_DB_PATH}'.`);
      DB_PATH = FALLBACK_DB_PATH;
      ensureDbFile();
      return;
    }
    throw error;
  }
}

function readDb() {
  const raw = fs.readFileSync(DB_PATH, "utf8");
  const db = JSON.parse(raw);
  return {
    users: Array.isArray(db.users) ? db.users : [],
    smsCodes: Array.isArray(db.smsCodes) ? db.smsCodes : [],
    schedules: Array.isArray(db.schedules) ? db.schedules : [],
    checkins: Array.isArray(db.checkins) ? db.checkins : []
  };
}

function writeDb(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (error) {
    if (IS_PROD && DB_PATH !== FALLBACK_DB_PATH) {
      console.warn(`Write DB failed on '${DB_PATH}', fallback to '${FALLBACK_DB_PATH}'.`);
      DB_PATH = FALLBACK_DB_PATH;
      ensureDbFile();
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
      return;
    }
    throw error;
  }
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "").trim();
}

function isValidPhone(phone) {
  return /^1\d{10}$/.test(phone);
}

function isValidPassword(password) {
  if (typeof password !== "string") {
    return false;
  }
  if (password.length < 6 || password.length > 32) {
    return false;
  }
  return /[A-Za-z]/.test(password) && /\d/.test(password);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value || ""));
}

function toPublicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    createdAt: user.createdAt
  };
}

function parseDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatWindow(date) {
  return date.toLocaleString("zh-CN", { hour12: false });
}

function buildTimeWindow(schedule, type) {
  const start = parseDateTime(schedule.date, schedule.startTime);
  const end = parseDateTime(schedule.date, schedule.endTime);

  if (type === "in") {
    return {
      start: addMinutes(start, -20),
      end: addMinutes(start, 20),
      label: "进站签到"
    };
  }

  return {
    start: addMinutes(end, -20),
    end: addMinutes(end, 20),
    label: "出站签到"
  };
}

function createToken(user) {
  return jwt.sign(
    { uid: user.id, phone: user.phone, name: user.name },
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
  } catch (error) {
    return res.status(401).json({ message: "登录令牌无效，请重新登录" });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.post("/api/auth/send-code", (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const purpose = req.body.purpose === "login" ? "login" : "register";

  if (!isValidPhone(phone)) {
    return res.status(400).json({ message: "手机号格式不正确" });
  }

  const db = readDb();
  const userExists = db.users.some((u) => u.phone === phone);

  if (purpose === "register" && userExists) {
    return res.status(409).json({ message: "该手机号已注册，请直接登录" });
  }

  if (purpose === "login" && !userExists) {
    return res.status(404).json({ message: "手机号未注册，请先注册" });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000;

  db.smsCodes = db.smsCodes.filter((item) => item.phone !== phone);
  db.smsCodes.push({
    id: crypto.randomUUID(),
    phone,
    purpose,
    code,
    expiresAt,
    createdAt: new Date().toISOString()
  });
  writeDb(db);

  return res.json({
    message: "验证码已发送（演示环境直接返回验证码）",
    code,
    expiresInSeconds: 300
  });
});

app.post("/api/auth/register", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || "").trim();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  const name = String(req.body.name || "").trim();

  if (!isValidPhone(phone)) {
    return res.status(400).json({ message: "手机号格式不正确" });
  }

  if (!code) {
    return res.status(400).json({ message: "请输入验证码" });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      message: "密码需为6-32位且包含字母和数字"
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: "两次输入的密码不一致" });
  }

  const db = readDb();
  if (db.users.some((u) => u.phone === phone)) {
    return res.status(409).json({ message: "该手机号已注册，请直接登录" });
  }

  const sms = db.smsCodes.find(
    (item) => item.phone === phone && item.purpose === "register"
  );

  if (!sms) {
    return res.status(400).json({ message: "请先获取验证码" });
  }
  if (Date.now() > sms.expiresAt) {
    db.smsCodes = db.smsCodes.filter((item) => item.id !== sms.id);
    writeDb(db);
    return res.status(400).json({ message: "验证码已过期，请重新获取" });
  }
  if (sms.code !== code) {
    return res.status(400).json({ message: "验证码错误" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    phone,
    passwordHash,
    name: name || `用户${phone.slice(-4)}`,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  db.smsCodes = db.smsCodes.filter((item) => item.id !== sms.id);
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

app.get("/api/schedules", authMiddleware, (req, res) => {
  const date = String(req.query.date || "").trim();
  if (date && !isValidDate(date)) {
    return res.status(400).json({ message: "日期格式错误，应为 YYYY-MM-DD" });
  }

  const db = readDb();
  const schedules = db.schedules
    .filter((s) => s.userId === req.user.id)
    .filter((s) => (date ? s.date === date : true))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
    .map((schedule) => {
      const checkin = db.checkins.find(
        (item) => item.userId === req.user.id && item.scheduleId === schedule.id
      );
      return {
        ...schedule,
        checkin: checkin || null
      };
    });

  return res.json({ schedules });
});

app.post("/api/schedules", authMiddleware, (req, res) => {
  const date = String(req.body.date || "").trim();
  const startTime = String(req.body.startTime || "").trim();
  const endTime = String(req.body.endTime || "").trim();
  const title = String(req.body.title || "").trim();

  if (!isValidDate(date)) {
    return res.status(400).json({ message: "日期格式错误，应为 YYYY-MM-DD" });
  }
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return res.status(400).json({ message: "时间格式错误，应为 HH:mm" });
  }

  const start = parseDateTime(date, startTime);
  const end = parseDateTime(date, endTime);
  if (end <= start) {
    return res.status(400).json({ message: "结束时间必须晚于开始时间" });
  }

  const db = readDb();
  const sameDaySchedules = db.schedules.filter(
    (item) => item.userId === req.user.id && item.date === date
  );

  const overlap = sameDaySchedules.some((item) => {
    const itemStart = parseDateTime(item.date, item.startTime);
    const itemEnd = parseDateTime(item.date, item.endTime);
    return start < itemEnd && end > itemStart;
  });

  if (overlap) {
    return res.status(409).json({ message: "该时间段与已有值班安排重叠" });
  }

  const schedule = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    date,
    startTime,
    endTime,
    title: title || "值班安排",
    createdAt: new Date().toISOString()
  };

  db.schedules.push(schedule);
  writeDb(db);

  return res.status(201).json({ message: "值班安排已创建", schedule });
});

app.delete("/api/schedules/:id", authMiddleware, (req, res) => {
  const id = String(req.params.id || "");
  const db = readDb();

  const index = db.schedules.findIndex(
    (item) => item.id === id && item.userId === req.user.id
  );
  if (index < 0) {
    return res.status(404).json({ message: "未找到该值班安排" });
  }

  db.schedules.splice(index, 1);
  db.checkins = db.checkins.filter(
    (item) => !(item.scheduleId === id && item.userId === req.user.id)
  );
  writeDb(db);

  return res.json({ message: "值班安排已删除" });
});

app.post("/api/checkins", authMiddleware, (req, res) => {
  const scheduleId = String(req.body.scheduleId || "");
  const type = req.body.type === "out" ? "out" : "in";
  const remark = String(req.body.remark || "").trim();

  if (!scheduleId) {
    return res.status(400).json({ message: "请选择值班安排" });
  }

  const db = readDb();
  const schedule = db.schedules.find(
    (item) => item.id === scheduleId && item.userId === req.user.id
  );
  if (!schedule) {
    return res.status(404).json({ message: "未找到匹配的值班安排" });
  }

  const now = new Date();
  const window = buildTimeWindow(schedule, type);
  if (now < window.start || now > window.end) {
    return res.status(400).json({
      message: `${window.label}不在允许时间范围内`,
      allowedWindow: `${formatWindow(window.start)} ~ ${formatWindow(window.end)}`
    });
  }

  let record = db.checkins.find(
    (item) => item.userId === req.user.id && item.scheduleId === schedule.id
  );

  if (!record) {
    record = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      scheduleId: schedule.id,
      date: schedule.date,
      checkInAt: null,
      checkOutAt: null,
      checkInRemark: "",
      checkOutRemark: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.checkins.push(record);
  }

  if (type === "in") {
    if (record.checkInAt) {
      return res.status(409).json({ message: "该班次已经进站签到，无需重复操作" });
    }
    record.checkInAt = now.toISOString();
    record.checkInRemark = remark;
  } else {
    if (!record.checkInAt) {
      return res.status(400).json({ message: "请先完成进站签到，再进行出站签到" });
    }
    if (record.checkOutAt) {
      return res.status(409).json({ message: "该班次已经出站签到，无需重复操作" });
    }
    record.checkOutAt = now.toISOString();
    record.checkOutRemark = remark;
  }

  record.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({
    message: type === "in" ? "进站签到成功" : "出站签到成功",
    checkin: record
  });
});

app.get("/api/checkins", authMiddleware, (req, res) => {
  const date = String(req.query.date || "").trim();
  if (date && !isValidDate(date)) {
    return res.status(400).json({ message: "日期格式错误，应为 YYYY-MM-DD" });
  }

  const db = readDb();
  const schedulesMap = new Map(db.schedules.map((item) => [item.id, item]));
  const checkins = db.checkins
    .filter((item) => item.userId === req.user.id)
    .filter((item) => (date ? item.date === date : true))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((item) => ({
      ...item,
      schedule: schedulesMap.get(item.scheduleId) || null
    }));

  return res.json({ checkins });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureDbFile();
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`DB_PATH=${DB_PATH}`);
});
