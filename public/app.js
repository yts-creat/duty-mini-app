const state = {
  token: localStorage.getItem("token") || "",
  user: null,
  authMode: "register",
  activeTab: "mine",
  currentSchedule: null,
  mySlots: [],
  myOvertimeRows: [],
  publicRows: [],
  publicOvertimeRows: [],
  importDraft: [],
  theme: localStorage.getItem("theme") || "sunrise"
};

const weekdayMap = {
  1: "星期一",
  2: "星期二",
  3: "星期三",
  4: "星期四",
  5: "星期五",
  6: "星期六",
  7: "星期日"
};

const importWeekdayMap = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日"
};

const themeNames = new Set(["sunrise", "ocean", "forest", "berry"]);

const els = {
  toast: document.getElementById("toast"),
  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),
  switchRegister: document.getElementById("switchRegister"),
  switchLogin: document.getElementById("switchLogin"),
  registerForm: document.getElementById("registerForm"),
  loginForm: document.getElementById("loginForm"),
  logoutBtn: document.getElementById("logoutBtn"),
  userAvatar: document.getElementById("userAvatar"),
  userName: document.getElementById("userName"),
  userRole: document.getElementById("userRole"),
  userAccountLabel: document.getElementById("userAccountLabel"),
  userDepartment: document.getElementById("userDepartment"),
  profileAvatar: document.getElementById("profileAvatar"),
  profileName: document.getElementById("profileName"),
  profileAccount: document.getElementById("profileAccount"),
  profileDepartment: document.getElementById("profileDepartment"),
  profileRoleBadge: document.getElementById("profileRoleBadge"),
  importPermissionText: document.getElementById("importPermissionText"),
  avatarFile: document.getElementById("avatarFile"),
  saveAvatarBtn: document.getElementById("saveAvatarBtn"),
  removeAvatarBtn: document.getElementById("removeAvatarBtn"),
  currentPassword: document.getElementById("currentPassword"),
  newPassword: document.getElementById("newPassword"),
  confirmNewPassword: document.getElementById("confirmNewPassword"),
  changePasswordBtn: document.getElementById("changePasswordBtn"),
  tabMine: document.getElementById("tabMine"),
  tabPublic: document.getElementById("tabPublic"),
  tabImport: document.getElementById("tabImport"),
  panelMine: document.getElementById("panelMine"),
  panelPublic: document.getElementById("panelPublic"),
  panelImport: document.getElementById("panelImport"),
  currentScheduleInfo: document.getElementById("currentScheduleInfo"),
  guestScheduleInfo: document.getElementById("guestScheduleInfo"),
  publicScheduleInfo: document.getElementById("publicScheduleInfo"),
  mineStats: document.getElementById("mineStats"),
  guestStats: document.getElementById("guestStats"),
  publicStats: document.getElementById("publicStats"),
  mySlots: document.getElementById("mySlots"),
  myOvertimeBody: document.getElementById("myOvertimeBody"),
  publicTableBody: document.getElementById("publicTableBody"),
  publicGuestTableBody: document.getElementById("publicGuestTableBody"),
  publicOvertimeBody: document.getElementById("publicOvertimeBody"),
  publicGuestOvertimeBody: document.getElementById("publicGuestOvertimeBody"),
  refreshPublicBtn: document.getElementById("refreshPublicBtn"),
  refreshPublicGuestBtn: document.getElementById("refreshPublicGuestBtn"),
  refreshMineBtn: document.getElementById("refreshMineBtn"),
  exportPublicDutyBtn: document.getElementById("exportPublicDutyBtn"),
  exportPublicOvertimeBtn: document.getElementById("exportPublicOvertimeBtn"),
  exportGuestDutyBtn: document.getElementById("exportGuestDutyBtn"),
  exportGuestOvertimeBtn: document.getElementById("exportGuestOvertimeBtn"),
  overtimeDate: document.getElementById("overtimeDate"),
  overtimeStart: document.getElementById("overtimeStart"),
  overtimeEnd: document.getElementById("overtimeEnd"),
  overtimeRemark: document.getElementById("overtimeRemark"),
  saveOvertimeBtn: document.getElementById("saveOvertimeBtn"),
  resetOvertimeBtn: document.getElementById("resetOvertimeBtn"),
  importTitle: document.getElementById("importTitle"),
  importWeekStart: document.getElementById("importWeekStart"),
  importImageFile: document.getElementById("importImageFile"),
  recognizeBtn: document.getElementById("recognizeBtn"),
  recognizeResult: document.getElementById("recognizeResult"),
  importEditorCard: document.getElementById("importEditorCard"),
  importRowsBody: document.getElementById("importRowsBody"),
  addImportRowBtn: document.getElementById("addImportRowBtn"),
  confirmImportBtn: document.getElementById("confirmImportBtn"),
  loginAccount: document.getElementById("loginAccount"),
  loginPassword: document.getElementById("loginPassword"),
  themeToolbar: document.getElementById("themeToolbar"),
  themeButtons: Array.from(document.querySelectorAll(".theme-btn"))
};

function isAdmin() {
  return state.user?.role === "admin";
}

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  els.toast.classList.toggle("error", isError);
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2800);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "-";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest} 分钟`;
  if (!rest) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}

function getAccountText(user = state.user) {
  if (!user) return "-";
  return user.role === "admin" ? user.loginAccount || "管理员" : user.phone || user.loginAccount || "-";
}

function getRoleText(user = state.user) {
  return user?.role === "admin" ? "管理员" : "普通成员";
}

function getScheduleText() {
  if (!state.currentSchedule) {
    return "暂无值班表，请先导入本周排班。";
  }
  const schedule = state.currentSchedule;
  return `${schedule.title}（${schedule.weekStartDate} - ${schedule.weekEndDate}）`;
}

function metricMarkup(label, value, hint) {
  return `
    <article class="metric-card">
      <p class="metric-label">${escapeHtml(label)}</p>
      <strong class="metric-value">${escapeHtml(value)}</strong>
      <p class="metric-hint">${escapeHtml(hint || "")}</p>
    </article>
  `;
}

function renderMetricGrid(target, metrics) {
  if (!target) return;
  target.innerHTML = metrics.map((item) => metricMarkup(item.label, item.value, item.hint)).join("");
}

function renderAvatar(target, user) {
  if (!target) return;
  const fallback = escapeHtml((user?.name || user?.loginAccount || "创").slice(0, 1));
  if (user?.avatarDataUrl) {
    target.innerHTML = `<img src="${user.avatarDataUrl}" alt="头像" class="avatar-image" />`;
  } else {
    target.innerHTML = `<span class="avatar-fallback">${fallback}</span>`;
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  els.switchRegister.classList.toggle("active", isRegister);
  els.switchLogin.classList.toggle("active", !isRegister);
  els.registerForm.classList.toggle("hidden", !isRegister);
  els.loginForm.classList.toggle("hidden", isRegister);
}

function setTab(tab) {
  const nextTab = tab === "import" && !isAdmin() ? "mine" : tab;
  state.activeTab = nextTab;
  els.tabMine.classList.toggle("active", nextTab === "mine");
  els.tabPublic.classList.toggle("active", nextTab === "public");
  els.tabImport.classList.toggle("active", nextTab === "import");
  els.panelMine.classList.toggle("hidden", nextTab !== "mine");
  els.panelPublic.classList.toggle("hidden", nextTab !== "public");
  els.panelImport.classList.toggle("hidden", nextTab !== "import");
}

function setAuthed(authed) {
  els.authView.classList.toggle("hidden", authed);
  els.appView.classList.toggle("hidden", !authed);
}

function applyTheme(themeName) {
  const nextTheme = themeNames.has(themeName) ? themeName : "sunrise";
  state.theme = nextTheme;
  localStorage.setItem("theme", nextTheme);
  document.documentElement.setAttribute("data-theme", nextTheme);
  for (const button of els.themeButtons) {
    button.classList.toggle("active", button.dataset.themeName === nextTheme);
  }
}

function persistUser(user) {
  state.user = user;
  localStorage.setItem("user", JSON.stringify(user));
  renderUser();
}

function saveSession(token, user) {
  state.token = token;
  localStorage.setItem("token", token);
  persistUser(user);
  setAuthed(true);
  setTab("mine");
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.mySlots = [];
  state.myOvertimeRows = [];
  localStorage.removeItem("token");
  localStorage.removeItem("user");
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

function renderUser() {
  const user = state.user;
  if (!user) return;

  renderAvatar(els.userAvatar, user);
  renderAvatar(els.profileAvatar, user);
  els.userName.textContent = user.name || "-";
  els.userRole.textContent = getRoleText(user);
  els.userAccountLabel.textContent = user.role === "admin" ? `账号：${getAccountText(user)}` : `手机号：${getAccountText(user)}`;
  els.userDepartment.textContent = user.department || "-";

  els.profileName.textContent = user.name || "-";
  els.profileAccount.textContent = getAccountText(user);
  els.profileDepartment.textContent = user.department || "-";
  els.profileRoleBadge.textContent = getRoleText(user);
  els.importPermissionText.textContent = isAdmin() ? "可识别与导入值班表" : "仅管理员可导入";

  els.tabImport.classList.toggle("hidden", !isAdmin());
  if (!isAdmin() && state.activeTab === "import") {
    setTab("mine");
  }
}

function renderScheduleInfo() {
  const text = getScheduleText();
  els.currentScheduleInfo.textContent = text;
  els.guestScheduleInfo.textContent = text;
  els.publicScheduleInfo.textContent = text;
}

function renderMineMetrics() {
  const total = state.mySlots.length;
  const completed = state.mySlots.filter((slot) => slot.checkin?.checkOutAt).length;
  const checkedIn = state.mySlots.filter(
    (slot) => slot.checkin?.checkInAt && !slot.checkin?.checkOutAt
  ).length;
  const pending = Math.max(total - completed - checkedIn, 0);
  const overtimeMinutes = state.myOvertimeRows.reduce(
    (sum, row) => sum + Number(row.overtimeMinutes || 0),
    0
  );

  renderMetricGrid(els.mineStats, [
    { label: "本周班次", value: `${total}`, hint: isAdmin() ? "管理员默认不参与自动排班" : "与你手机号或姓名匹配" },
    { label: "已完成", value: `${completed}`, hint: "已进站且已出站" },
    { label: "待完成", value: `${pending}`, hint: checkedIn ? `其中 ${checkedIn} 个已进站` : "还未开始签到" },
    { label: "加班记录", value: `${state.myOvertimeRows.length}`, hint: overtimeMinutes ? `累计 ${formatDuration(overtimeMinutes)}` : "当前暂无加班" }
  ]);
}

function renderPublicMetrics() {
  const total = state.publicRows.length;
  const completed = state.publicRows.filter((row) => row.status === "已完成").length;
  const checkedIn = state.publicRows.filter((row) => row.status === "已进站").length;
  const overtimeMinutes = state.publicOvertimeRows.reduce(
    (sum, row) => sum + Number(row.overtimeMinutes || 0),
    0
  );
  const metrics = [
    { label: "总值班班次", value: `${total}`, hint: "当前导入表中的正常值班" },
    { label: "已完成签到", value: `${completed}`, hint: "已完成进站与出站" },
    { label: "进行中", value: `${checkedIn}`, hint: "已进站，等待出站" },
    { label: "加班记录", value: `${state.publicOvertimeRows.length}`, hint: overtimeMinutes ? `累计 ${formatDuration(overtimeMinutes)}` : "当前暂无加班" }
  ];
  renderMetricGrid(els.guestStats, metrics);
  renderMetricGrid(els.publicStats, metrics);
}

function slotStatus(slot) {
  if (!slot.checkin?.checkInAt) return { label: "未签到", cls: "wait" };
  if (slot.checkin?.checkInAt && !slot.checkin?.checkOutAt) return { label: "已进站", cls: "partial" };
  return { label: "已完成", cls: "done" };
}

function renderMySlots() {
  if (!state.mySlots.length) {
    els.mySlots.innerHTML = `
      <div class="card empty-card">
        <h3>${isAdmin() ? "管理员账号默认不参与自动值班" : "本周还没有匹配到你的值班"}</h3>
        <p class="sub">${isAdmin() ? "你可以继续使用公共看板、导入值班表、修改头像和密码功能。" : "请确认注册手机号与导入值班表中的手机号一致，或者检查值班表中的姓名是否正确。"}</p>
      </div>
    `;
    return;
  }

  els.mySlots.innerHTML = state.mySlots
    .map((slot) => {
      const status = slotStatus(slot);
      const checkin = slot.checkin || {};
      return `
        <article class="slot-card">
          <div class="slot-card-head">
            <div>
              <h3>${escapeHtml(slot.date)} ${escapeHtml(slot.startTime)} - ${escapeHtml(slot.endTime)}</h3>
              <p class="slot-meta">${escapeHtml(slot.weekdayLabel || weekdayMap[slot.weekday] || "")} · ${escapeHtml(slot.name || state.user?.name || "")}</p>
            </div>
            <span class="status-tag ${status.cls}">${escapeHtml(status.label)}</span>
          </div>
          <p class="slot-meta">进站时间窗：${escapeHtml(slot.inWindowText || "-")}</p>
          <p class="slot-meta">出站时间窗：${escapeHtml(slot.outWindowText || "-")}</p>
          <p class="slot-meta">进站记录：${escapeHtml(formatDateTime(checkin.checkInAt))}</p>
          <p class="slot-meta">出站记录：${escapeHtml(formatDateTime(checkin.checkOutAt))}</p>
          <div class="form-grid two-col compact-form-grid">
            <label>
              进站备注
              <input id="inRemark_${slot.id}" value="${escapeHtml(checkin.inRemark || "")}" placeholder="例如：值班巡检、电话接待、内容审核" />
            </label>
            <label>
              出站备注
              <input id="outRemark_${slot.id}" value="${escapeHtml(checkin.outRemark || "")}" placeholder="例如：已交接、问题已反馈、日报已提交" />
            </label>
          </div>
          <div class="slot-actions">
            <button class="primary" data-action="checkin-in" data-id="${slot.id}" ${checkin.checkInAt ? "disabled" : ""}>进站签到</button>
            <button class="secondary" data-action="checkin-out" data-id="${slot.id}" ${!checkin.checkInAt || checkin.checkOutAt ? "disabled" : ""}>出站签到</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMyOvertime() {
  if (!state.myOvertimeRows.length) {
    els.myOvertimeBody.innerHTML = '<tr><td colspan="5">暂无加班记录</td></tr>';
    return;
  }

  els.myOvertimeBody.innerHTML = state.myOvertimeRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(row.startTime)}</td>
          <td>${escapeHtml(row.endTime)}</td>
          <td>${escapeHtml(formatDuration(row.overtimeMinutes))}</td>
          <td>${escapeHtml(row.remark || "-")}</td>
        </tr>
      `
    )
    .join("");
}

function buildRemarkText(row) {
  const parts = [];
  if (row.inRemark) parts.push(`进：${row.inRemark}`);
  if (row.outRemark) parts.push(`出：${row.outRemark}`);
  return parts.length ? parts.join(" / ") : "-";
}

function renderDutyTable(target) {
  if (!target) return;
  if (!state.publicRows.length) {
    target.innerHTML = '<tr><td colspan="9">暂无正常值班数据</td></tr>';
    return;
  }

  target.innerHTML = state.publicRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.date)} ${escapeHtml(row.weekday)}</td>
          <td>${escapeHtml(row.startTime)} - ${escapeHtml(row.endTime)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.phone)}</td>
          <td>${escapeHtml(row.department || "-")}</td>
          <td>${escapeHtml(row.status)}</td>
          <td>${escapeHtml(formatDateTime(row.checkInAt))}</td>
          <td>${escapeHtml(formatDateTime(row.checkOutAt))}</td>
          <td>${escapeHtml(buildRemarkText(row))}</td>
        </tr>
      `
    )
    .join("");
}

function renderOvertimeTable(target) {
  if (!target) return;
  if (!state.publicOvertimeRows.length) {
    target.innerHTML = '<tr><td colspan="8">暂无加班数据</td></tr>';
    return;
  }

  target.innerHTML = state.publicOvertimeRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(row.startTime)}</td>
          <td>${escapeHtml(row.endTime)}</td>
          <td>${escapeHtml(formatDuration(row.overtimeMinutes))}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.phone)}</td>
          <td>${escapeHtml(row.department || "-")}</td>
          <td>${escapeHtml(row.remark || "-")}</td>
        </tr>
      `
    )
    .join("");
}

function renderPublicTables() {
  renderDutyTable(els.publicTableBody);
  renderDutyTable(els.publicGuestTableBody);
  renderOvertimeTable(els.publicOvertimeBody);
  renderOvertimeTable(els.publicGuestOvertimeBody);
}

function renderAll() {
  if (state.user) {
    renderUser();
    renderMineMetrics();
    renderMySlots();
    renderMyOvertime();
  }
  renderScheduleInfo();
  renderPublicMetrics();
  renderPublicTables();
}

async function fetchPublicOverview() {
  const resp = await fetch("/api/public/overview");
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.message || "获取公共看板失败");
  }
  return data;
}

function renderImportRows() {
  if (!state.importDraft.length) {
    els.importRowsBody.innerHTML = '<tr><td colspan="7">暂无识别结果，请先上传值班表文件。</td></tr>';
    return;
  }

  els.importRowsBody.innerHTML = state.importDraft
    .map(
      (row, idx) => `
        <tr>
          <td>
            <select class="import-weekday-select" data-field="weekday" data-idx="${idx}">
              ${[1, 2, 3, 4, 5, 6, 7]
                .map((n) => `<option value="${n}" ${Number(row.weekday) === n ? "selected" : ""}>${importWeekdayMap[n]}</option>`)
                .join("")}
            </select>
          </td>
          <td><input data-field="date" data-idx="${idx}" value="${escapeHtml(row.date || "")}" /></td>
          <td><input data-field="startTime" data-idx="${idx}" value="${escapeHtml(row.startTime || "")}" /></td>
          <td><input data-field="endTime" data-idx="${idx}" value="${escapeHtml(row.endTime || "")}" /></td>
          <td><input data-field="name" data-idx="${idx}" value="${escapeHtml(row.name || "")}" /></td>
          <td><input data-field="phone" data-idx="${idx}" value="${escapeHtml(row.phone || "")}" /></td>
          <td><input data-field="department" data-idx="${idx}" value="${escapeHtml(row.department || "")}" placeholder="可留空" /></td>
        </tr>
      `
    )
    .join("");
}

async function refreshAll() {
  const [scheduleRes, myRes, myOvertimeRes, publicRes] = await Promise.all([
    api("/api/schedule/current"),
    api("/api/my/slots"),
    api("/api/my/overtime"),
    fetchPublicOverview()
  ]);

  state.currentSchedule = scheduleRes.currentSchedule || publicRes.currentSchedule || null;
  state.mySlots = myRes.slots || [];
  state.myOvertimeRows = myOvertimeRes.rows || [];
  state.publicRows = publicRes.rows || [];
  state.publicOvertimeRows = publicRes.overtimeRows || [];
  renderAll();
}

async function refreshPublicOnly() {
  const publicRes = await fetchPublicOverview();
  state.currentSchedule = publicRes.currentSchedule || null;
  state.publicRows = publicRes.rows || [];
  state.publicOvertimeRows = publicRes.overtimeRows || [];
  renderScheduleInfo();
  renderPublicMetrics();
  renderPublicTables();
}

async function tryRestore() {
  const savedUser = localStorage.getItem("user");
  if (!state.token || !savedUser) {
    clearSession();
    await refreshPublicOnly().catch(() => {});
    return;
  }

  try {
    const me = await api("/api/me");
    persistUser(me.user);
    setAuthed(true);
    await refreshAll();
  } catch (_error) {
    clearSession();
    await refreshPublicOnly().catch(() => {});
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const body = {
    name: document.getElementById("regName").value.trim(),
    phone: document.getElementById("regPhone").value.trim(),
    department: document.getElementById("regDepartment").value.trim(),
    password: document.getElementById("regPassword").value,
    confirmPassword: document.getElementById("regConfirmPassword").value
  };

  try {
    const data = await api("/api/auth/register", { method: "POST", body });
    saveSession(data.token, data.user);
    await refreshAll();
    toast("注册成功，已自动登录");
  } catch (error) {
    toast(error.message, true);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const body = {
    account: els.loginAccount.value.trim(),
    password: els.loginPassword.value
  };

  try {
    const data = await api("/api/auth/login", { method: "POST", body });
    saveSession(data.token, data.user);
    await refreshAll();
    toast("登录成功");
  } catch (error) {
    toast(error.message, true);
  }
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("读取图片失败"));
    img.src = dataUrl;
  });
}

async function buildAvatarDataUrl(file) {
  if (!file) {
    throw new Error("请先选择头像图片");
  }
  if (!/^image\//.test(file.type)) {
    throw new Error("头像请选择图片文件");
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error("头像原图请控制在 4MB 以内");
  }

  const rawDataUrl = await readDataUrl(file);
  const image = await loadImage(rawDataUrl);
  const size = 220;
  const side = Math.min(image.width, image.height);
  const sx = (image.width - side) / 2;
  const sy = (image.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function clearPasswordForm() {
  els.currentPassword.value = "";
  els.newPassword.value = "";
  els.confirmNewPassword.value = "";
}

function collectImportRowsFromDom() {
  const rows = [];
  const trList = Array.from(els.importRowsBody.querySelectorAll("tr"));
  for (const tr of trList) {
    const weekday = Number(tr.querySelector('[data-field="weekday"]')?.value || 0);
    const date = tr.querySelector('[data-field="date"]')?.value.trim() || "";
    const startTime = tr.querySelector('[data-field="startTime"]')?.value.trim() || "";
    const endTime = tr.querySelector('[data-field="endTime"]')?.value.trim() || "";
    const name = tr.querySelector('[data-field="name"]')?.value.trim() || "";
    const phone = tr.querySelector('[data-field="phone"]')?.value.trim() || "";
    const department = tr.querySelector('[data-field="department"]')?.value.trim() || "";
    rows.push({ weekday, date, startTime, endTime, name, phone, department });
  }
  return rows;
}

async function handleRecognize() {
  if (!isAdmin()) {
    toast("仅管理员可以识别值班表", true);
    return;
  }

  const file = els.importImageFile.files?.[0];
  const weekStartDate = els.importWeekStart.value;
  const title = els.importTitle.value.trim() || "值班表导入";
  if (!file) {
    toast("请先选择值班表文件", true);
    return;
  }
  if (!weekStartDate) {
    toast("请先选择本周周一日期", true);
    return;
  }

  try {
    els.recognizeBtn.disabled = true;
    els.recognizeResult.textContent =
      file.type === "application/pdf"
        ? "正在解析 PDF，请稍候..."
        : "正在识别图片，请稍候...";
    const fileDataUrl = await readDataUrl(file);
    const data = await api("/api/schedule/recognize", {
      method: "POST",
      body: { title, weekStartDate, fileDataUrl }
    });
    state.importDraft = data.slots || [];
    renderImportRows();
    els.importEditorCard.classList.remove("hidden");
    els.recognizeResult.textContent = data.message || "识别完成";
    toast("识别完成，请先核对再导入");
  } catch (error) {
    els.recognizeResult.textContent = "";
    toast(error.message, true);
  } finally {
    els.recognizeBtn.disabled = false;
  }
}

async function handleConfirmImport() {
  if (!isAdmin()) {
    toast("仅管理员可以导入值班表", true);
    return;
  }

  const weekStartDate = els.importWeekStart.value;
  const title = els.importTitle.value.trim() || "值班表导入";
  if (!weekStartDate) {
    toast("请先选择本周周一日期", true);
    return;
  }

  const rows = collectImportRowsFromDom();
  const ok = window.confirm("确认导入该值班表吗？这会清空历史签到和加班记录。");
  if (!ok) return;

  try {
    const data = await api("/api/schedule/import", {
      method: "POST",
      body: { title, weekStartDate, slots: rows }
    });
    toast(data.message || "导入成功");
    await refreshAll();
    setTab("public");
  } catch (error) {
    toast(error.message, true);
  }
}

function addImportRow() {
  state.importDraft.push({
    weekday: 1,
    date: "",
    startTime: "08:00",
    endTime: "09:40",
    name: "",
    phone: "",
    department: ""
  });
  renderImportRows();
}

async function doCheckIn(slotId, type) {
  try {
    const inRemark = document.getElementById(`inRemark_${slotId}`)?.value.trim() || "";
    const outRemark = document.getElementById(`outRemark_${slotId}`)?.value.trim() || "";
    if (type === "in") {
      await api("/api/checkins/in", {
        method: "POST",
        body: { slotId, remark: inRemark }
      });
      toast("进站签到成功");
    } else {
      await api("/api/checkins/out", {
        method: "POST",
        body: { slotId, remark: outRemark }
      });
      toast("出站签到成功");
    }
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  }
}

function resetOvertimeForm() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  els.overtimeDate.value = `${y}-${m}-${d}`;
  els.overtimeStart.value = "18:00";
  els.overtimeEnd.value = "19:00";
  els.overtimeRemark.value = "";
}

async function saveOvertime() {
  const body = {
    date: els.overtimeDate.value,
    startTime: els.overtimeStart.value,
    endTime: els.overtimeEnd.value,
    remark: els.overtimeRemark.value.trim()
  };

  try {
    els.saveOvertimeBtn.disabled = true;
    const data = await api("/api/overtime", {
      method: "POST",
      body
    });
    toast(data.message || "加班记录已保存");
    resetOvertimeForm();
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.saveOvertimeBtn.disabled = false;
  }
}

async function saveAvatar() {
  try {
    els.saveAvatarBtn.disabled = true;
    const avatarDataUrl = await buildAvatarDataUrl(els.avatarFile.files?.[0]);
    const data = await api("/api/me/avatar", {
      method: "POST",
      body: { avatarDataUrl }
    });
    persistUser(data.user);
    els.avatarFile.value = "";
    toast(data.message || "头像更新成功");
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.saveAvatarBtn.disabled = false;
  }
}

async function removeAvatar() {
  try {
    els.removeAvatarBtn.disabled = true;
    const data = await api("/api/me/avatar", {
      method: "DELETE"
    });
    persistUser(data.user);
    els.avatarFile.value = "";
    toast(data.message || "头像已移除");
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.removeAvatarBtn.disabled = false;
  }
}

async function changePassword() {
  const body = {
    currentPassword: els.currentPassword.value,
    newPassword: els.newPassword.value,
    confirmPassword: els.confirmNewPassword.value
  };

  try {
    els.changePasswordBtn.disabled = true;
    const data = await api("/api/auth/change-password", {
      method: "POST",
      body
    });
    if (data.user) {
      persistUser(data.user);
    }
    clearPasswordForm();
    toast(data.message || "密码修改成功");
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.changePasswordBtn.disabled = false;
  }
}

async function downloadCsv(endpoint, filename) {
  const resp = await fetch(endpoint);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.message || "导出失败");
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportDutyCsv() {
  try {
    await downloadCsv("/api/public/export-duty.csv", "正常值班统计.csv");
    toast("正常值班统计已导出");
  } catch (error) {
    toast(error.message, true);
  }
}

async function exportOvertimeCsv() {
  try {
    await downloadCsv("/api/public/export-overtime.csv", "加班统计.csv");
    toast("加班统计已导出");
  } catch (error) {
    toast(error.message, true);
  }
}

function bindEvents() {
  els.switchRegister.addEventListener("click", () => setAuthMode("register"));
  els.switchLogin.addEventListener("click", () => setAuthMode("login"));
  els.registerForm.addEventListener("submit", handleRegister);
  els.loginForm.addEventListener("submit", handleLogin);

  els.logoutBtn.addEventListener("click", () => {
    clearSession();
    toast("已退出登录");
    refreshPublicOnly().catch(() => {});
  });

  els.tabMine.addEventListener("click", () => setTab("mine"));
  els.tabPublic.addEventListener("click", () => setTab("public"));
  els.tabImport.addEventListener("click", () => setTab("import"));

  els.themeToolbar.addEventListener("click", (event) => {
    const target = event.target.closest(".theme-btn");
    if (!(target instanceof HTMLButtonElement)) return;
    applyTheme(target.dataset.themeName || "sunrise");
  });

  els.saveAvatarBtn.addEventListener("click", saveAvatar);
  els.removeAvatarBtn.addEventListener("click", removeAvatar);
  els.changePasswordBtn.addEventListener("click", changePassword);

  els.recognizeBtn.addEventListener("click", handleRecognize);
  els.confirmImportBtn.addEventListener("click", handleConfirmImport);
  els.addImportRowBtn.addEventListener("click", addImportRow);

  els.refreshMineBtn.addEventListener("click", async () => {
    try {
      await refreshAll();
      toast("我的数据已刷新");
    } catch (error) {
      toast(error.message, true);
    }
  });

  els.refreshPublicBtn.addEventListener("click", async () => {
    try {
      await refreshAll();
      toast("公共看板已刷新");
    } catch (error) {
      toast(error.message, true);
    }
  });

  els.refreshPublicGuestBtn.addEventListener("click", async () => {
    try {
      await refreshPublicOnly();
      toast("公共看板已刷新");
    } catch (error) {
      toast(error.message, true);
    }
  });

  els.exportPublicDutyBtn.addEventListener("click", exportDutyCsv);
  els.exportPublicOvertimeBtn.addEventListener("click", exportOvertimeCsv);
  els.exportGuestDutyBtn.addEventListener("click", exportDutyCsv);
  els.exportGuestOvertimeBtn.addEventListener("click", exportOvertimeCsv);
  els.saveOvertimeBtn.addEventListener("click", saveOvertime);
  els.resetOvertimeBtn.addEventListener("click", resetOvertimeForm);

  els.mySlots.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.action;
    const slotId = target.dataset.id;
    if (!action || !slotId) return;
    if (action === "checkin-in") {
      doCheckIn(slotId, "in");
    } else if (action === "checkin-out") {
      doCheckIn(slotId, "out");
    }
  });
}

function setDefaultImportDate() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  els.importWeekStart.value = `${y}-${m}-${d}`;
}

function bootstrap() {
  bindEvents();
  applyTheme(state.theme);
  setAuthMode("register");
  setTab("mine");
  setDefaultImportDate();
  resetOvertimeForm();
  tryRestore();
}

bootstrap();
