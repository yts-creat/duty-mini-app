const state = {
  token: localStorage.getItem("token") || "",
  user: null,
  authMode: "register",
  activeTab: "mine",
  currentSchedule: null,
  mySlots: [],
  publicRows: [],
  importDraft: []
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

const els = {
  toast: document.getElementById("toast"),
  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),
  switchRegister: document.getElementById("switchRegister"),
  switchLogin: document.getElementById("switchLogin"),
  registerForm: document.getElementById("registerForm"),
  loginForm: document.getElementById("loginForm"),
  logoutBtn: document.getElementById("logoutBtn"),
  userName: document.getElementById("userName"),
  userPhone: document.getElementById("userPhone"),
  userDepartment: document.getElementById("userDepartment"),
  tabMine: document.getElementById("tabMine"),
  tabPublic: document.getElementById("tabPublic"),
  tabImport: document.getElementById("tabImport"),
  panelMine: document.getElementById("panelMine"),
  panelPublic: document.getElementById("panelPublic"),
  panelImport: document.getElementById("panelImport"),
  currentScheduleInfo: document.getElementById("currentScheduleInfo"),
  mySlots: document.getElementById("mySlots"),
  publicTableBody: document.getElementById("publicTableBody"),
  publicGuestTableBody: document.getElementById("publicGuestTableBody"),
  refreshPublicBtn: document.getElementById("refreshPublicBtn"),
  refreshPublicGuestBtn: document.getElementById("refreshPublicGuestBtn"),
  exportPublicBtn: document.getElementById("exportPublicBtn"),
  exportPublicGuestBtn: document.getElementById("exportPublicGuestBtn"),
  importTitle: document.getElementById("importTitle"),
  importWeekStart: document.getElementById("importWeekStart"),
  importImageFile: document.getElementById("importImageFile"),
  recognizeBtn: document.getElementById("recognizeBtn"),
  recognizeResult: document.getElementById("recognizeResult"),
  importEditorCard: document.getElementById("importEditorCard"),
  importRowsBody: document.getElementById("importRowsBody"),
  addImportRowBtn: document.getElementById("addImportRowBtn"),
  confirmImportBtn: document.getElementById("confirmImportBtn")
};

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
  return date.toLocaleString("zh-CN", { hour12: false });
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
  state.activeTab = tab;
  els.tabMine.classList.toggle("active", tab === "mine");
  els.tabPublic.classList.toggle("active", tab === "public");
  els.tabImport.classList.toggle("active", tab === "import");
  els.panelMine.classList.toggle("hidden", tab !== "mine");
  els.panelPublic.classList.toggle("hidden", tab !== "public");
  els.panelImport.classList.toggle("hidden", tab !== "import");
}

function setAuthed(authed) {
  els.authView.classList.toggle("hidden", authed);
  els.appView.classList.toggle("hidden", !authed);
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
  setAuthed(true);
  renderUser();
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.currentSchedule = null;
  state.mySlots = [];
  state.publicRows = [];
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
    if (resp.status === 401) clearSession();
    throw new Error(data.message || "请求失败");
  }
  return data;
}

function renderUser() {
  if (!state.user) return;
  els.userName.textContent = state.user.name;
  els.userPhone.textContent = state.user.phone;
  els.userDepartment.textContent = state.user.department || "-";
}

function renderScheduleTitle() {
  if (!state.currentSchedule) {
    els.currentScheduleInfo.textContent = "暂无值班表，请先在“导入值班表”里上传并识别。";
    return;
  }
  const s = state.currentSchedule;
  els.currentScheduleInfo.textContent = `${s.title}（${s.weekStartDate} ~ ${s.weekEndDate}）`;
}

function slotStatus(slot) {
  if (!slot.checkin?.checkInAt) return { label: "未签到", cls: "wait" };
  if (slot.checkin?.checkInAt && !slot.checkin?.checkOutAt) return { label: "已进站", cls: "partial" };
  return { label: "已完成", cls: "done" };
}

function renderMySlots() {
  if (!state.mySlots.length) {
    els.mySlots.innerHTML = '<div class="card"><p class="sub">本周没有匹配到你的值班时间，请确认手机号是否和导入值班表一致。</p></div>';
    return;
  }

  els.mySlots.innerHTML = state.mySlots
    .map((slot) => {
      const status = slotStatus(slot);
      const checkin = slot.checkin || {};
      return `
        <article class="slot-card">
          <h3>${escapeHtml(slot.date)} ${escapeHtml(slot.startTime)}-${escapeHtml(slot.endTime)}</h3>
          <p class="slot-meta">${escapeHtml(slot.weekdayLabel || weekdayMap[slot.weekday] || "")} · ${escapeHtml(slot.name || state.user.name)}</p>
          <p class="slot-meta">签到窗口：进站 ${escapeHtml(slot.inWindowText)} ｜ 出站 ${escapeHtml(slot.outWindowText)}</p>
          <p class="slot-meta"><span class="status-tag ${status.cls}">${status.label}</span></p>
          <p class="slot-meta">进站时间：${escapeHtml(formatDateTime(checkin.checkInAt))}</p>
          <p class="slot-meta">出站时间：${escapeHtml(formatDateTime(checkin.checkOutAt))}</p>

          <label>进站备注
            <input id="inRemark_${slot.id}" placeholder="如：值班巡检、处理咨询等" />
          </label>
          <label>出站备注
            <input id="outRemark_${slot.id}" placeholder="如：完成日报、汇总反馈等" />
          </label>
          <div class="slot-actions">
            <button class="primary" data-action="checkin-in" data-id="${slot.id}" ${checkin.checkInAt ? "disabled" : ""}>进站签到</button>
            <button class="primary" data-action="checkin-out" data-id="${slot.id}" ${!checkin.checkInAt || checkin.checkOutAt ? "disabled" : ""}>出站签到</button>
          </div>

          <label>加班开始时间
            <input id="otStart_${slot.id}" type="time" value="${escapeHtml(checkin.overtimeStart || "")}" />
          </label>
          <label>加班时长（分钟）
            <input id="otMinutes_${slot.id}" type="number" min="1" max="720" value="${checkin.overtimeMinutes || ""}" />
          </label>
          <label>加班备注
            <input id="otRemark_${slot.id}" value="${escapeHtml(checkin.overtimeRemark || "")}" placeholder="如：处理突发问题、活动支持" />
          </label>
          <button class="secondary" data-action="save-overtime" data-id="${slot.id}">保存加班信息</button>
        </article>
      `;
    })
    .join("");
}

function renderPublicTableIn(target) {
  if (!target) return;
  if (!state.publicRows.length) {
    target.innerHTML = '<tr><td colspan="9">暂无公共数据</td></tr>';
    return;
  }
  target.innerHTML = state.publicRows
    .map((row) => {
      const overtimeText =
        row.overtimeMinutes > 0
          ? `${escapeHtml(row.overtimeStart || "-")} / ${row.overtimeMinutes} 分钟`
          : "-";
      return `
        <tr>
          <td>${escapeHtml(row.date)} ${escapeHtml(row.weekday)}</td>
          <td>${escapeHtml(row.startTime)}-${escapeHtml(row.endTime)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.phone)}</td>
          <td>${escapeHtml(row.department)}</td>
          <td>${escapeHtml(row.status)}</td>
          <td>${escapeHtml(formatDateTime(row.checkInAt))}</td>
          <td>${escapeHtml(formatDateTime(row.checkOutAt))}</td>
          <td>${overtimeText}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPublicTable() {
  renderPublicTableIn(els.publicTableBody);
  renderPublicTableIn(els.publicGuestTableBody);
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
    els.importRowsBody.innerHTML = '<tr><td colspan="7">暂无识别结果，请先上传截图识别。</td></tr>';
    return;
  }

  els.importRowsBody.innerHTML = state.importDraft
    .map(
      (row, idx) => `
      <tr>
        <td>
          <select data-field="weekday" data-idx="${idx}">
            ${[1, 2, 3, 4, 5, 6, 7]
              .map((n) => `<option value="${n}" ${Number(row.weekday) === n ? "selected" : ""}>${weekdayMap[n]}</option>`)
              .join("")}
          </select>
        </td>
        <td><input data-field="date" data-idx="${idx}" value="${escapeHtml(row.date || "")}" /></td>
        <td><input data-field="startTime" data-idx="${idx}" value="${escapeHtml(row.startTime || "")}" /></td>
        <td><input data-field="endTime" data-idx="${idx}" value="${escapeHtml(row.endTime || "")}" /></td>
        <td><input data-field="name" data-idx="${idx}" value="${escapeHtml(row.name || "")}" /></td>
        <td><input data-field="phone" data-idx="${idx}" value="${escapeHtml(row.phone || "")}" /></td>
        <td><input data-field="department" data-idx="${idx}" value="${escapeHtml(row.department || "")}" placeholder="可选" /></td>
      </tr>
    `
    )
    .join("");
}

async function refreshAll() {
  const [scheduleRes, myRes, publicRes] = await Promise.all([
    api("/api/schedule/current"),
    api("/api/my/slots"),
    fetchPublicOverview()
  ]);
  state.currentSchedule = scheduleRes.currentSchedule;
  state.mySlots = myRes.slots || [];
  state.publicRows = publicRes.rows || [];
  renderScheduleTitle();
  renderMySlots();
  renderPublicTable();
}

async function refreshPublicOnly() {
  const publicRes = await fetchPublicOverview();
  state.publicRows = publicRes.rows || [];
  renderPublicTable();
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
    state.user = me.user;
    localStorage.setItem("user", JSON.stringify(me.user));
    renderUser();
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
    department: document.getElementById("regDepartment").value,
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
    phone: document.getElementById("loginPhone").value.trim(),
    password: document.getElementById("loginPassword").value
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
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
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
  const file = els.importImageFile.files?.[0];
  const weekStartDate = els.importWeekStart.value;
  const title = els.importTitle.value.trim() || "值班表导入";
  if (!file) {
    toast("请先选择值班表截图", true);
    return;
  }
  if (!weekStartDate) {
    toast("请先选择本周周一日期", true);
    return;
  }

  try {
    els.recognizeBtn.disabled = true;
    els.recognizeResult.textContent = "识别中，请稍候（图片越清晰越快）...";
    const imageDataUrl = await readDataUrl(file);
    const data = await api("/api/schedule/recognize", {
      method: "POST",
      body: { title, weekStartDate, imageDataUrl }
    });
    state.importDraft = data.slots || [];
    renderImportRows();
    els.importEditorCard.classList.remove("hidden");
    els.recognizeResult.textContent = data.message || "";
    toast("识别完成，请先核对再导入");
  } catch (error) {
    els.recognizeResult.textContent = "";
    toast(error.message, true);
  } finally {
    els.recognizeBtn.disabled = false;
  }
}

async function handleConfirmImport() {
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

async function saveOvertime(slotId) {
  const overtimeStart = document.getElementById(`otStart_${slotId}`)?.value || "";
  const overtimeMinutes = Number(document.getElementById(`otMinutes_${slotId}`)?.value || 0);
  const overtimeRemark = document.getElementById(`otRemark_${slotId}`)?.value.trim() || "";
  try {
    await api("/api/checkins/overtime", {
      method: "POST",
      body: { slotId, overtimeStart, overtimeMinutes, overtimeRemark }
    });
    toast("加班信息已保存");
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  }
}

async function exportPublicCsv() {
  try {
    const resp = await fetch("/api/public/export.csv");
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.message || "导出失败");
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "公共签到统计.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("导出成功");
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

  els.recognizeBtn.addEventListener("click", handleRecognize);
  els.confirmImportBtn.addEventListener("click", handleConfirmImport);
  els.addImportRowBtn.addEventListener("click", addImportRow);

  els.refreshPublicBtn.addEventListener("click", async () => {
    try {
      if (state.user) {
        await refreshAll();
      } else {
        await refreshPublicOnly();
      }
      toast("数据已刷新");
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
  els.exportPublicBtn.addEventListener("click", exportPublicCsv);
  els.exportPublicGuestBtn.addEventListener("click", exportPublicCsv);

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
    } else if (action === "save-overtime") {
      saveOvertime(slotId);
    }
  });
}

function setDefaultImportDate() {
  const now = new Date();
  const day = now.getDay(); // 0 Sun, 1 Mon ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  els.importWeekStart.value = `${y}-${m}-${d}`;
}

function bootstrap() {
  bindEvents();
  setAuthMode("register");
  setTab("mine");
  setDefaultImportDate();
  tryRestore();
  refreshPublicOnly().catch(() => {});
}

bootstrap();
