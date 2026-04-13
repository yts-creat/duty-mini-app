const state = {
  token: localStorage.getItem("token") || "",
  user: null,
  mode: "register",
  schedules: [],
  checkins: []
};

const el = {
  toast: document.getElementById("toast"),
  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),
  tabRegister: document.getElementById("tabRegister"),
  tabLogin: document.getElementById("tabLogin"),
  registerForm: document.getElementById("registerForm"),
  loginForm: document.getElementById("loginForm"),
  sendCodeBtn: document.getElementById("sendCodeBtn"),
  profileName: document.getElementById("profileName"),
  profilePhone: document.getElementById("profilePhone"),
  logoutBtn: document.getElementById("logoutBtn"),
  scheduleForm: document.getElementById("scheduleForm"),
  scheduleList: document.getElementById("scheduleList"),
  checkinList: document.getElementById("checkinList"),
  refreshBtn: document.getElementById("refreshBtn"),
  scheduleDate: document.getElementById("scheduleDate")
};

function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  el.toast.classList.toggle("error", isError);
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    el.toast.classList.add("hidden");
  }, 2600);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setMode(mode) {
  state.mode = mode;
  const isRegister = mode === "register";
  el.tabRegister.classList.toggle("active", isRegister);
  el.tabLogin.classList.toggle("active", !isRegister);
  el.registerForm.classList.toggle("hidden", !isRegister);
  el.loginForm.classList.toggle("hidden", isRegister);
}

function setAuthed(authed) {
  el.authView.classList.toggle("hidden", authed);
  el.appView.classList.toggle("hidden", !authed);
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
  renderProfile();
  setAuthed(true);
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.schedules = [];
  state.checkins = [];
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  renderSchedules();
  renderCheckins();
  setAuthed(false);
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const resp = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401) {
      clearSession();
    }
    throw new Error(data.message || "请求失败");
  }
  return data;
}

function formatDateTime(iso) {
  if (!iso) return "未签到";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
}

function buildWindows(schedule) {
  const start = new Date(`${schedule.date}T${schedule.startTime}:00`);
  const end = new Date(`${schedule.date}T${schedule.endTime}:00`);
  const inStart = new Date(start.getTime() - 20 * 60 * 1000);
  const inEnd = new Date(start.getTime() + 20 * 60 * 1000);
  const outStart = new Date(end.getTime() - 20 * 60 * 1000);
  const outEnd = new Date(end.getTime() + 20 * 60 * 1000);
  return {
    inText: `${inStart.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} - ${inEnd.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
    outText: `${outStart.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} - ${outEnd.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  };
}

function renderProfile() {
  if (!state.user) return;
  el.profileName.textContent = state.user.name;
  el.profilePhone.textContent = state.user.phone;
}

function renderSchedules() {
  if (!state.schedules.length) {
    el.scheduleList.innerHTML = '<p class="muted">今天还没有值班安排，先新增一条吧。</p>';
    return;
  }

  el.scheduleList.innerHTML = state.schedules
    .map((schedule) => {
      const checkin = schedule.checkin;
      const windows = buildWindows(schedule);
      const inDone = Boolean(checkin && checkin.checkInAt);
      const outDone = Boolean(checkin && checkin.checkOutAt);
      return `
        <article class="item">
          <h3>${escapeHtml(schedule.title)}</h3>
          <p>日期：${escapeHtml(schedule.date)} | 班次：${escapeHtml(schedule.startTime)} - ${escapeHtml(schedule.endTime)}</p>
          <p>进站窗口：${escapeHtml(windows.inText)}（前后20分钟）</p>
          <p>出站窗口：${escapeHtml(windows.outText)}（前后20分钟）</p>
          <p>
            <span class="status ${outDone ? "done" : "waiting"}">
              ${outDone ? "已完成出站" : inDone ? "待出站" : "待进站"}
            </span>
          </p>
          <div class="item-actions">
            <button class="primary" data-action="checkin-in" data-id="${schedule.id}" ${inDone ? "disabled" : ""}>进站签到</button>
            <button class="primary" data-action="checkin-out" data-id="${schedule.id}" ${!inDone || outDone ? "disabled" : ""}>出站签到</button>
            <button class="secondary" data-action="delete-schedule" data-id="${schedule.id}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCheckins() {
  if (!state.checkins.length) {
    el.checkinList.innerHTML = '<p class="muted">今天还没有签到记录。</p>';
    return;
  }

  el.checkinList.innerHTML = state.checkins
    .map((item) => {
      const title = item.schedule?.title || "值班安排";
      return `
        <article class="item">
          <h3>${escapeHtml(title)}（${escapeHtml(item.date)}）</h3>
          <p>进站时间：${escapeHtml(formatDateTime(item.checkInAt))}</p>
          <p>出站时间：${escapeHtml(formatDateTime(item.checkOutAt))}</p>
        </article>
      `;
    })
    .join("");
}

async function loadTodayData() {
  const date = el.scheduleDate.value;
  const [scheduleData, checkinData] = await Promise.all([
    api(`/api/schedules?date=${encodeURIComponent(date)}`),
    api(`/api/checkins?date=${encodeURIComponent(date)}`)
  ]);
  state.schedules = scheduleData.schedules;
  state.checkins = checkinData.checkins;
  renderSchedules();
  renderCheckins();
}

async function handleRegister(event) {
  event.preventDefault();
  const phone = document.getElementById("registerPhone").value.trim();
  const code = document.getElementById("registerCode").value.trim();
  const password = document.getElementById("registerPassword").value;
  const confirmPassword = document.getElementById("registerConfirmPassword").value;
  const name = document.getElementById("registerName").value.trim();

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: { phone, code, password, confirmPassword, name }
    });
    saveSession(data.token, data.user);
    await loadTodayData();
    showToast("注册成功，已自动登录");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const phone = document.getElementById("loginPhone").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: { phone, password }
    });
    saveSession(data.token, data.user);
    await loadTodayData();
    showToast("登录成功");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleSendCode() {
  const phone = document.getElementById("registerPhone").value.trim();
  if (!/^1\d{10}$/.test(phone)) {
    showToast("请输入正确的11位手机号", true);
    return;
  }

  try {
    const data = await api("/api/auth/send-code", {
      method: "POST",
      body: { phone, purpose: "register" }
    });
    showToast(`验证码已发送（演示环境）：${data.code}`);
    startCodeCountdown();
  } catch (error) {
    showToast(error.message, true);
  }
}

function startCodeCountdown() {
  let remain = 60;
  el.sendCodeBtn.disabled = true;
  el.sendCodeBtn.textContent = `${remain}s`;
  const timer = setInterval(() => {
    remain -= 1;
    if (remain <= 0) {
      clearInterval(timer);
      el.sendCodeBtn.disabled = false;
      el.sendCodeBtn.textContent = "获取验证码";
      return;
    }
    el.sendCodeBtn.textContent = `${remain}s`;
  }, 1000);
}

async function handleCreateSchedule(event) {
  event.preventDefault();
  const date = document.getElementById("scheduleDate").value;
  const startTime = document.getElementById("scheduleStartTime").value;
  const endTime = document.getElementById("scheduleEndTime").value;
  const title = document.getElementById("scheduleTitle").value.trim();

  try {
    await api("/api/schedules", {
      method: "POST",
      body: { date, startTime, endTime, title }
    });
    await loadTodayData();
    showToast("值班安排已创建");
    event.target.reset();
    initScheduleDefaults();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleCheckin(scheduleId, type) {
  try {
    const message = type === "in" ? "进站备注（可选）" : "出站备注（可选）";
    const remark = window.prompt(message, "") || "";
    await api("/api/checkins", {
      method: "POST",
      body: { scheduleId, type, remark }
    });
    await loadTodayData();
    showToast(type === "in" ? "进站签到成功" : "出站签到成功");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleDeleteSchedule(scheduleId) {
  const ok = window.confirm("确认删除该值班安排吗？");
  if (!ok) return;

  try {
    await api(`/api/schedules/${scheduleId}`, { method: "DELETE" });
    await loadTodayData();
    showToast("值班安排已删除");
  } catch (error) {
    showToast(error.message, true);
  }
}

function initScheduleDefaults() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  el.scheduleDate.value = date;
}

async function tryRestoreSession() {
  const savedUser = localStorage.getItem("user");
  if (!state.token || !savedUser) {
    clearSession();
    return;
  }

  try {
    const data = await api("/api/me");
    state.user = data.user;
    localStorage.setItem("user", JSON.stringify(data.user));
    renderProfile();
    setAuthed(true);
    await loadTodayData();
  } catch (_error) {
    clearSession();
  }
}

function bindEvents() {
  el.tabRegister.addEventListener("click", () => setMode("register"));
  el.tabLogin.addEventListener("click", () => setMode("login"));
  el.registerForm.addEventListener("submit", handleRegister);
  el.loginForm.addEventListener("submit", handleLogin);
  el.sendCodeBtn.addEventListener("click", handleSendCode);
  el.scheduleForm.addEventListener("submit", handleCreateSchedule);
  el.refreshBtn.addEventListener("click", async () => {
    try {
      await loadTodayData();
      showToast("数据已刷新");
    } catch (error) {
      showToast(error.message, true);
    }
  });
  el.logoutBtn.addEventListener("click", () => {
    clearSession();
    showToast("已退出登录");
  });

  el.scheduleList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) return;
    if (action === "checkin-in") {
      handleCheckin(id, "in");
    } else if (action === "checkin-out") {
      handleCheckin(id, "out");
    } else if (action === "delete-schedule") {
      handleDeleteSchedule(id);
    }
  });
}

function bootstrap() {
  bindEvents();
  setMode("register");
  initScheduleDefaults();
  tryRestoreSession();
}

bootstrap();
