import { ICONS, injectIcons } from "./icons.js";
import { FLOOR_LAYOUTS, hasLayout } from "./floors.js";

// === 定数 ===
const DAYS = ["月", "火", "水", "木", "金", "土"];
const PERIODS = [1, 2, 3, 4, 5, 6];
const PERIOD_TIMES = {
  1: ["09:00", "10:40"],
  2: ["10:50", "12:30"],
  3: ["13:20", "15:00"],
  4: ["15:10", "16:50"],
  5: ["17:00", "18:40"],
  6: ["18:50", "20:30"],
};
// 6F は当面除外 (必要なら "6" と "6F" ラベルを再追加)
const FLOORS = ["all", "B1", "1", "2", "3", "5"];
const FLOOR_LABELS = { all: "全階", B1: "B1", "1": "1F", "2": "2F", "3": "3F", "5": "5F" };
const WINGS = ["C", "N", "W", "E"];

// フィルタ選択肢
const FILTER_OPTIONS = [
  { value: "all", label: "全て", meta: "すべての教室を表示" },
  { value: "free", label: "空きのみ", meta: "今授業がない教室だけ" },
  { value: "friends", label: "友達がいる教室", meta: "フォロー中の友達がマーク済み" },
  { value: "wing-C", label: "C棟のみ", meta: "Center wing" },
  { value: "wing-N", label: "N棟のみ", meta: "North wing" },
  { value: "wing-W", label: "W棟のみ", meta: "West wing" },
  { value: "wing-E", label: "E棟のみ", meta: "East wing" },
];

const SEMESTER_OPTIONS = [
  { value: "spring", label: "春学期", meta: "4月〜7月" },
  { value: "fall", label: "秋学期", meta: "9月〜1月" },
];

// モック友達
const MOCK_FRIENDS = [
  { id: "f1", name: "太郎", marker: { room: "5C04", kind: "planned" } },
  { id: "f2", name: "花子", marker: { room: "5W04", kind: "in" } },
  { id: "f3", name: "次郎", marker: null },
];

// === State ===
const state = {
  semester: "spring",
  day: "月",
  period: 3,
  floor: "all",
  view: "list",
  filter: "all",
  selectedRoom: null,
  myMarkers: loadMyMarkers(),
  // Phase 2
  authReady: false,    // Firebase Auth の初期判定が終わったか
  user: null,          // { uid, displayName, photoURL, email } | null
  userProfile: null,   // Firestore users/{uid} ドキュメント
  timetable: [],       // [{semester, day, period, room, courseId, courseName}]
  follows: [],         // [{uid, userName, displayName, photoURL}]
};

let SCHEDULE = null;
let ROOMS = null;
let ALL_COURSES = []; // 全コースをフラット化 [{slotId, semester, day, period, room, courseId, courseName, professor}]

// === 初期化 ===
async function init() {
  injectIcons();
  await loadData();
  setNowState();
  bindEvents();
  bindTabs();
  bindAuth();
  bindCourseSearch();
  initAuth();
  render();
  renderMeTab();
  renderFriendsTab();
}

// === タブ切替 (教室 / 友達 / マイ) ===
function bindTabs() {
  const tabs = document.querySelectorAll(".foot-btn[data-tab]");
  const contents = document.querySelectorAll("[data-tab-content]");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      tabs.forEach((b) => b.classList.toggle("on", b === btn));
      contents.forEach((c) => {
        c.hidden = c.dataset.tabContent !== tab;
      });
    });
  });
}

// === Firebase 認証 ===
function bindAuth() {
  document.getElementById("btn-login-from-me")?.addEventListener("click", login);
  document.getElementById("btn-login-from-friends")?.addEventListener("click", login);
  document.getElementById("btn-logout")?.addEventListener("click", logout);
  document.getElementById("btn-edit-username")?.addEventListener("click", editUserName);
}

function initAuth() {
  const ready = () => {
    const fb = window.__firebase;
    if (!fb) return;
    fb.fns.onAuthStateChanged(fb.auth, async (user) => {
      state.authReady = true;
      if (user) {
        state.user = {
          uid: user.uid,
          displayName: user.displayName,
          photoURL: user.photoURL,
          email: user.email,
        };
        // Firestore 取得を待たずに先に基本情報を描画 (反応速度優先)
        renderMeTab();
        renderFriendsTab();
        try {
          await Promise.all([loadUserProfile(), loadTimetable()]);
          renderMeTab();
        } catch (e) {
          console.warn("Firestore load error:", e?.code || e?.message || e);
          state.userProfile = null;
        }
      } else {
        state.user = null;
        state.userProfile = null;
        renderMeTab();
        renderFriendsTab();
      }
    });
  };
  if (window.__firebase) ready();
  else window.__onFirebaseReady = ready;
}

async function login() {
  const fb = window.__firebase;
  if (!fb) { alert("Firebase が読み込まれていません"); return; }
  try {
    await fb.fns.signInWithPopup(fb.auth, fb.googleProvider);
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user") {
      alert("ログインに失敗: " + e.message);
    }
  }
}

async function logout() {
  await window.__firebase.fns.signOut(window.__firebase.auth);
}

// Firestore: users/{uid} を取得 (初回ログインなら新規作成)
async function loadUserProfile() {
  const fb = window.__firebase;
  const { fns, db } = fb;
  const ref = fns.doc(db, "users", state.user.uid);
  const snap = await fns.getDoc(ref);
  if (snap.exists()) {
    state.userProfile = snap.data();
  } else {
    // 初回: Google 表示名から仮ユーザー名を生成
    const fallback = (state.user.displayName || "user").replace(/\s+/g, "").slice(0, 12) || "user";
    const newDoc = {
      displayName: state.user.displayName || "",
      photoURL: state.user.photoURL || "",
      email: state.user.email || "",
      userName: null, // 未設定状態 (本人が設定するまで検索対象外)
      fallbackName: fallback,
      createdAt: fns.serverTimestamp(),
    };
    await fns.setDoc(ref, newDoc);
    state.userProfile = newDoc;
  }
}

async function editUserName() {
  if (!state.user) { alert("ログインが必要です"); return; }
  const cur = state.userProfile?.userName || "";
  const next = prompt("ユーザー名を入力 (英数字とアンダースコア、3〜20文字)\n他の人があなたを検索するときに使う名前です", cur);
  if (next === null) return;
  const trimmed = next.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(trimmed)) {
    alert("3〜20文字の英数字とアンダースコアで指定してください");
    return;
  }
  // 楽観更新: 即UI反映 (Firestore の応答を待たない)
  const oldName = state.userProfile?.userName || null;
  if (!state.userProfile) state.userProfile = {};
  state.userProfile.userName = trimmed;
  renderMeTab();
  // Firestore: バックグラウンドで保存
  const fb = window.__firebase;
  const { fns, db } = fb;
  try {
    const nameRef = fns.doc(db, "userNames", trimmed.toLowerCase());
    const nameSnap = await fns.getDoc(nameRef);
    if (nameSnap.exists() && nameSnap.data().uid !== state.user.uid) {
      state.userProfile.userName = oldName;
      renderMeTab();
      alert("そのユーザー名は既に使われています");
      return;
    }
    if (oldName && oldName.toLowerCase() !== trimmed.toLowerCase()) {
      try { await fns.deleteDoc(fns.doc(db, "userNames", oldName.toLowerCase())); } catch {}
    }
    await fns.setDoc(nameRef, { uid: state.user.uid });
    await fns.setDoc(fns.doc(db, "users", state.user.uid), { userName: trimmed }, { merge: true });
  } catch (e) {
    state.userProfile.userName = oldName;
    renderMeTab();
    alert("ユーザー名の保存に失敗: " + (e?.code || e?.message || e));
  }
}

// === マイタブ・友達タブの認証連動表示 ===
// 状態: 1) authReady=false → 読み込み中  2) user あり → 本体  3) user なし → ログインゲート
function renderMeTab() {
  const loading = document.getElementById("me-loading");
  const gate = document.getElementById("me-auth-gate");
  const body = document.getElementById("me-body");
  if (!gate || !body) return;
  if (!state.authReady) {
    if (loading) loading.hidden = false;
    gate.hidden = true;
    body.hidden = true;
    return;
  }
  if (loading) loading.hidden = true;
  if (state.user) {
    gate.hidden = true;
    body.hidden = false;
    const avatar = document.getElementById("me-avatar");
    if (avatar) avatar.src = state.user.photoURL || "";
    document.getElementById("me-displayname").textContent = state.user.displayName || "";
    const uname = state.userProfile?.userName;
    document.getElementById("me-username").textContent = uname ? `@${uname}` : "(ユーザー名未設定)";
    renderTimetable();
  } else {
    gate.hidden = false;
    body.hidden = true;
  }
}

function renderFriendsTab() {
  const loading = document.getElementById("friends-loading");
  const gate = document.getElementById("friends-auth-gate");
  const body = document.getElementById("friends-body");
  if (!gate || !body) return;
  if (!state.authReady) {
    if (loading) loading.hidden = false;
    gate.hidden = true;
    body.hidden = true;
    return;
  }
  if (loading) loading.hidden = true;
  if (state.user) {
    gate.hidden = true;
    body.hidden = false;
  } else {
    gate.hidden = false;
    body.hidden = true;
  }
}

// === コース検索シート ===
let lastSearchHits = []; // event delegation 用に保持
function bindCourseSearch() {
  document.getElementById("btn-add-course")?.addEventListener("click", openCoursePicker);
  const input = document.getElementById("course-search-input");
  if (input) {
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderCourseResults(input.value.trim()), 150);
    });
  }
  // 結果リスト全体にデリゲート (個別バインドより堅牢)
  // data-idx は <button> に付いている (iOS Safari 対策で <li> ではなく <button> をラップ)
  const ul = document.getElementById("course-results");
  if (ul) {
    ul.addEventListener("click", (e) => {
      const el = e.target.closest("[data-idx]");
      if (!el) return;
      const idx = Number(el.dataset.idx);
      const course = lastSearchHits[idx];
      if (course) addCourseToTimetable(course);
    });
  }
}

function openCoursePicker() {
  const sheet = document.getElementById("course-picker");
  if (!sheet) return;
  sheet.setAttribute("aria-hidden", "false");
  const title = sheet.querySelector(".picker-title");
  if (title) title.textContent = "時間割に追加";
  const input = document.getElementById("course-search-input");
  if (input) {
    input.value = "";
    input.placeholder = "コース名で検索 (例: 民法)";
    renderCourseResults("");
    setTimeout(() => input.focus(), 100);
  }
}

function renderCourseResults(query) {
  const ul = document.getElementById("course-results");
  if (!ul) return;
  if (!query) {
    ul.innerHTML = '<li class="empty-state">コース名を入力してください</li>';
    return;
  }
  const q = query.toLowerCase();
  const hits = ALL_COURSES.filter((c) => c.courseName.toLowerCase().includes(q)).slice(0, 100);
  if (!hits.length) {
    ul.innerHTML = '<li class="empty-state">該当するコースがありません</li>';
    return;
  }
  // 学期 → 曜日 → 時限 でソート
  const dayOrder = { "月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6 };
  hits.sort((a, b) => {
    if (a.semester !== b.semester) return a.semester === "spring" ? -1 : 1;
    if (a.day !== b.day) return (dayOrder[a.day] || 9) - (dayOrder[b.day] || 9);
    return a.period - b.period;
  });
  lastSearchHits = hits; // delegation で参照される
  // iOS Safari の click 発火対策で <button> ラップ
  ul.innerHTML = hits.map((c, i) => {
    const sem = c.semester === "spring" ? "春" : "秋";
    return `<li><button type="button" class="course-result-btn" data-idx="${i}">
      <div class="course-name">${escapeHtml(c.courseName)}</div>
      <div class="course-meta">
        <span class="badge">${sem}${c.day}${c.period}</span>
        <span class="badge">${c.room}</span>
        ${escapeHtml((c.professor || "").slice(0, 40))}
      </div>
    </button></li>`;
  }).join("");
}

// === 時間割 CRUD ===
async function addCourseToTimetable(course) {
  if (!state.user) { alert("ログインが必要です"); return; }
  // 楽観更新: 即UI反映 (Firestore 書き込み完了を待たない)
  const existingIdx = state.timetable.findIndex((t) => t.slotId === course.slotId);
  const oldEntry = existingIdx >= 0 ? state.timetable[existingIdx] : null;
  const entry = { ...course };
  if (existingIdx >= 0) state.timetable[existingIdx] = entry;
  else state.timetable.push(entry);
  document.getElementById("course-picker").setAttribute("aria-hidden", "true");
  renderTimetable();
  // Firestore 書き込み (バックグラウンド)
  const fb = window.__firebase;
  const { fns, db } = fb;
  try {
    await fns.setDoc(fns.doc(db, "users", state.user.uid, "timetable", course.slotId), {
      semester: course.semester,
      day: course.day,
      period: course.period,
      room: course.room,
      courseId: course.courseId,
      courseName: course.courseName,
      professor: course.professor || "",
    });
  } catch (e) {
    // ロールバック
    if (oldEntry) state.timetable[existingIdx] = oldEntry;
    else state.timetable = state.timetable.filter((t) => t.slotId !== course.slotId);
    renderTimetable();
    alert("保存に失敗: " + (e?.code || e?.message || e));
  }
}

async function removeCourseFromTimetable(slotId) {
  if (!state.user) return;
  if (!confirm("この授業を時間割から削除しますか？")) return;
  const fb = window.__firebase;
  const { fns, db } = fb;
  try {
    await fns.deleteDoc(fns.doc(db, "users", state.user.uid, "timetable", slotId));
    state.timetable = state.timetable.filter((t) => t.slotId !== slotId);
    renderTimetable();
  } catch (e) {
    alert("削除に失敗: " + (e?.code || e?.message || e));
  }
}

async function loadTimetable() {
  if (!state.user) { state.timetable = []; return; }
  const fb = window.__firebase;
  const { fns, db } = fb;
  const snap = await fns.getDocs(fns.collection(db, "users", state.user.uid, "timetable"));
  state.timetable = [];
  snap.forEach((doc) => {
    const d = doc.data();
    state.timetable.push({ slotId: doc.id, ...d });
  });
}

function renderTimetable() {
  const root = document.getElementById("timetable-list");
  if (!root) return;
  if (!state.timetable.length) {
    root.innerHTML = '<div class="empty-state">まだ授業を登録していません</div>';
    return;
  }
  // 春・秋 をそれぞれ縦横マトリクス (時限×曜日) で描画
  const days = ["月", "火", "水", "木", "金", "土"];
  const periods = [1, 2, 3, 4, 5, 6, 7];
  const sems = [
    { key: "spring", label: "春学期" },
    { key: "fall", label: "秋学期" },
  ];
  // 登録済み学期がなければ春・秋 両方を空表で出す (空セルから登録できるように)
  const filledSems = sems.filter((s) => state.timetable.some((t) => t.semester === s.key));
  const showSems = filledSems.length ? sems : sems; // 常に両方表示
  let html = "";
  for (const sem of showSems) {
    const entries = state.timetable.filter((t) => t.semester === sem.key);
    const cellMap = {};
    for (const e of entries) cellMap[`${e.day}_${e.period}`] = e;
    html += `<div class="tt-section">
      <div class="tt-section-title">${sem.label}</div>
      <table class="tt-grid"><thead><tr><th></th>${days.map((d) => `<th>${d}</th>`).join("")}</tr></thead><tbody>
        ${periods.map((p) => `<tr><th>${p}</th>${days.map((d) => {
          const e = cellMap[`${d}_${p}`];
          if (e) {
            return `<td class="tt-cell tt-filled" data-slot="${e.slotId}">
              <div class="tt-cell-name">${escapeHtml(e.courseName)}</div>
              <div class="tt-cell-room">${e.room}</div>
            </td>`;
          }
          return `<td class="tt-cell tt-empty" data-sem="${sem.key}" data-day="${d}" data-period="${p}"></td>`;
        }).join("")}</tr>`).join("")}
      </tbody></table>
    </div>`;
  }
  root.innerHTML = html;
  // 埋まってるセルタップで削除
  root.querySelectorAll(".tt-filled").forEach((cell) => {
    cell.addEventListener("click", () => removeCourseFromTimetable(cell.dataset.slot));
  });
  // 空セルタップ → その曜日・時限の該当授業を出す
  root.querySelectorAll(".tt-empty").forEach((cell) => {
    cell.addEventListener("click", () => {
      openCoursePickerForSlot(cell.dataset.sem, cell.dataset.day, Number(cell.dataset.period));
    });
  });
}

// 特定スロット (学期・曜日・時限) 該当授業のみ出す
function openCoursePickerForSlot(semester, day, period) {
  const hits = ALL_COURSES.filter((c) => c.semester === semester && c.day === day && c.period === period);
  const semLabel = semester === "spring" ? "春" : "秋";
  const sheet = document.getElementById("course-picker");
  if (!sheet) return;
  sheet.setAttribute("aria-hidden", "false");
  // タイトルとして検索ボックスに「春月2」のように初期値を表示しない方が良い
  // 代わりにシートのタイトルを書き換え
  const title = sheet.querySelector(".picker-title");
  if (title) title.textContent = `${semLabel}${day}${period}限の授業`;
  const input = document.getElementById("course-search-input");
  if (input) {
    input.value = "";
    input.placeholder = `${semLabel}${day}${period}限から絞り込み (例: 民法)`;
  }
  // 結果を「該当授業」で固定描画
  renderCourseResultsFromList(hits);
}

function renderCourseResultsFromList(hits) {
  const ul = document.getElementById("course-results");
  if (!ul) return;
  if (!hits.length) {
    ul.innerHTML = '<li class="empty-state">この時限に授業はありません</li>';
    lastSearchHits = [];
    return;
  }
  lastSearchHits = hits;
  ul.innerHTML = hits.map((c, i) => {
    const sem = c.semester === "spring" ? "春" : "秋";
    return `<li><button type="button" class="course-result-btn" data-idx="${i}">
      <div class="course-name">${escapeHtml(c.courseName)}</div>
      <div class="course-meta">
        <span class="badge">${sem}${c.day}${c.period}</span>
        <span class="badge">${c.room}</span>
        ${escapeHtml((c.professor || "").slice(0, 40))}
      </div>
    </button></li>`;
  }).join("");
}

async function loadData() {
  const [s, r] = await Promise.all([
    fetch("./data/schedule.json").then((r) => r.json()),
    fetch("./data/rooms.json").then((r) => r.json()),
  ]);
  SCHEDULE = s;
  // B2 は表示対象から除外（加山さん指示）
  ROOMS = r.rooms.filter((room) => room.floor !== -2);
  // 全コースをフラット化 (時間割登録の検索用)
  buildAllCourses();
}

function buildAllCourses() {
  const out = [];
  const seen = new Set(); // courseId+semester+day+period+room で重複防止
  for (const room of Object.keys(SCHEDULE.by_room)) {
    const rdata = SCHEDULE.by_room[room];
    for (const semester of Object.keys(rdata)) {
      const sdata = rdata[semester];
      for (const day of Object.keys(sdata)) {
        const ddata = sdata[day];
        for (const period of Object.keys(ddata)) {
          for (const c of ddata[period]) {
            const key = `${c.id}_${semester}_${day}_${period}_${room}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              slotId: `${semester}_${day}_${period}`,
              semester,
              day,
              period: Number(period),
              room,
              courseId: c.id,
              courseName: c.name,
              professor: c.professor,
            });
          }
        }
      }
    }
  }
  ALL_COURSES = out;
}

function setNowState() {
  const now = new Date();
  const m = now.getMonth() + 1;
  state.semester = m >= 4 && m <= 9 ? "spring" : "fall";
  const dayIdx = now.getDay();
  if (dayIdx >= 1 && dayIdx <= 6) {
    state.day = DAYS[dayIdx - 1];
  } else {
    state.day = "月";
  }
  state.period = currentPeriod(now);
}

function currentPeriod(now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const p of PERIODS) {
    const [s, e] = PERIOD_TIMES[p];
    const startMin = toMin(s);
    const endMin = toMin(e);
    if (minutes >= startMin && minutes < endMin) return p;
    if (minutes < startMin) return p;
  }
  return 1;
}
function toMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function bindEvents() {
  // 階ピル → ピッカー開く
  document.querySelector('[data-picker="floor"]').addEventListener("click", () => {
    openPicker("floor");
  });
  // 表示切替
  document.querySelectorAll(".vt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateState({ view: btn.dataset.view });
    });
  });
  // シート閉じ（全シート共通）
  document.querySelectorAll("[data-close-sheet]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.closeSheet;
      document.getElementById(id).setAttribute("aria-hidden", "true");
      if (id === "detail-sheet") state.selectedRoom = null;
    });
  });
  // 1分ごとに現在時刻を再計算
  setInterval(() => {
    setNowState();
    render();
  }, 60000);
}

// === ピッカー === //
function openPicker(type) {
  const titleEl = document.getElementById("picker-title");
  const optsEl = document.getElementById("picker-options");
  optsEl.className = "picker-options";

  let title = "";
  let html = "";

  if (type === "floor") {
    title = "階を選択";
    optsEl.classList.add("grid", "grid-floor");
    html = FLOORS.map((f) => {
      const on = state.floor === f ? " on" : "";
      const sub = f === "all" ? "B1 〜 5F" :
                  f === "B1" ? "地下1階" :
                  `${f}階`;
      return `<button class="picker-opt-tile${on}" data-pick="floor" data-value="${f}">
        <span>${FLOOR_LABELS[f]}</span>
        <span class="sub">${sub}</span>
      </button>`;
    }).join("");
  } else if (type === "day") {
    title = "曜日を選択";
    optsEl.classList.add("grid", "grid-day");
    html = DAYS.map((d) => {
      const on = state.day === d ? " on" : "";
      return `<button class="picker-opt-tile${on}" data-pick="day" data-value="${d}">${d}曜</button>`;
    }).join("");
  } else if (type === "period") {
    title = "時限を選択";
    optsEl.classList.add("grid", "grid-period");
    html = PERIODS.map((p) => {
      const on = state.period === p ? " on" : "";
      const t = PERIOD_TIMES[p];
      return `<button class="picker-opt-tile${on}" data-pick="period" data-value="${p}">
        <span>${p}限</span>
        <span class="sub">${t[0]}–${t[1]}</span>
      </button>`;
    }).join("");
  } else if (type === "semester") {
    title = "学期を選択";
    html = SEMESTER_OPTIONS.map((o) => {
      const on = state.semester === o.value ? " on" : "";
      return `<button class="picker-opt-row${on}" data-pick="semester" data-value="${o.value}">
        <span class="check" data-icon="check"></span>
        <span class="label">${o.label}</span>
        <span class="opt-meta">${o.meta}</span>
      </button>`;
    }).join("");
  } else if (type === "filter") {
    title = "絞り込み";
    html = FILTER_OPTIONS.map((o) => {
      const on = state.filter === o.value ? " on" : "";
      return `<button class="picker-opt-row${on}" data-pick="filter" data-value="${o.value}">
        <span class="check" data-icon="check"></span>
        <span class="label">${o.label}</span>
        <span class="opt-meta">${o.meta}</span>
      </button>`;
    }).join("");
  }

  titleEl.textContent = title;
  optsEl.innerHTML = html;
  injectIcons(optsEl);

  optsEl.querySelectorAll("[data-pick]").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.pick;
      let value = b.dataset.value;
      if (key === "period") value = Number(value);
      updateState({ [key]: value });
      closePicker();
    });
  });

  document.getElementById("picker-sheet").setAttribute("aria-hidden", "false");
}

function closePicker() {
  document.getElementById("picker-sheet").setAttribute("aria-hidden", "true");
}

// === State 操作 ===
function updateState(partial) {
  Object.assign(state, partial);
  render();
}

function loadMyMarkers() {
  try {
    return JSON.parse(localStorage.getItem("my-markers") || "{}");
  } catch {
    return {};
  }
}
function saveMyMarkers() {
  localStorage.setItem("my-markers", JSON.stringify(state.myMarkers));
}

// === データ取得ヘルパー ===
function getRoomCourses(room, semester, day, period) {
  return (
    SCHEDULE.by_time?.[semester]?.[day]?.[String(period)]?.[room] || []
  );
}
function isBusy(room, semester, day, period) {
  return getRoomCourses(room, semester, day, period).length > 0;
}
function nextCoursesToday(room, semester, day, fromPeriod) {
  const out = [];
  const dayMap = SCHEDULE.by_room?.[room]?.[semester]?.[day] || {};
  for (const p of PERIODS) {
    if (p <= fromPeriod) continue;
    const cs = dayMap[String(p)] || [];
    for (const c of cs) out.push({ period: p, course: c });
  }
  return out;
}
function friendsInRoom(roomId) {
  return MOCK_FRIENDS.filter((f) => f.marker?.room === roomId);
}
// 自分 + 友達の合計（実際に部屋に「いる」人数 = inMarker / kind="in"）
function peopleInRoom(roomId) {
  const friendsIn = MOCK_FRIENDS.filter(
    (f) => f.marker?.room === roomId && f.marker?.kind === "in"
  );
  const meIn = state.myMarkers[roomId] === "in" ? 1 : 0;
  return friendsIn.length + meIn;
}
// 「予定」の人数 (友達 + 自分)
function plannersForRoom(roomId) {
  const friendsPlanned = MOCK_FRIENDS.filter(
    (f) => f.marker?.room === roomId && f.marker?.kind === "planned"
  );
  const mePlanned = state.myMarkers[roomId] === "planned" ? 1 : 0;
  return friendsPlanned.length + mePlanned;
}

// === レンダ ===
function render() {
  syncPills();
  renderNowSummary();
  renderHeaderSub();
  if (state.view === "list") {
    renderListView();
    setViewToggle("list");
  } else {
    renderMapView();
    setViewToggle("map");
  }
}

function syncPills() {
  document.getElementById("pv-floor").textContent = FLOOR_LABELS[state.floor];
}

function renderNowSummary() {
  document.getElementById("now-line").textContent = `今 ${state.period}限`;
}

function renderTimeDisplay() {
  const t = PERIOD_TIMES[state.period];
  const text = `${t[0]} – ${t[1]}  /  ${state.day}曜${state.period}限  /  ${
    state.semester === "spring" ? "春学期" : "秋学期"
  }`;
  document.getElementById("time-display").textContent = text;
}

function renderHeaderSub() {
  const total = ROOMS.length;
  const free = ROOMS.filter(
    (r) => !isBusy(r.room, state.semester, state.day, state.period)
  ).length;
  const sem = state.semester === "spring" ? "春" : "秋";
  document.getElementById("hd-sub").textContent = `${sem}・${state.day}${state.period}限・空き${free}室`;
}

function setViewToggle(view) {
  document.querySelectorAll(".vt-btn").forEach((b) => {
    b.classList.toggle("on", b.dataset.view === view);
    b.setAttribute("aria-selected", b.dataset.view === view ? "true" : "false");
  });
}

// === リスト表示 ===
function renderListView() {
  const filteredRooms = filterRooms(ROOMS);
  if (!filteredRooms.length) {
    document.getElementById("content").innerHTML =
      `<div class="empty-state">該当する教室がありません</div>`;
    return;
  }

  // 空き / 授業中 にグルーピング
  const free = [];
  const busy = [];
  for (const r of filteredRooms) {
    const courses = getRoomCourses(r.room, state.semester, state.day, state.period);
    if (courses.length === 0) free.push(r);
    else busy.push({ room: r, course: courses[0] });
  }

  const friendsByRoom = {};
  MOCK_FRIENDS.forEach((f) => {
    if (f.marker?.room) {
      friendsByRoom[f.marker.room] = friendsByRoom[f.marker.room] || [];
      friendsByRoom[f.marker.room].push(f);
    }
  });

  let html = "";

  if (free.length) {
    html += `<div class="list-section">`;
    html += `<div class="list-section-head">空き教室 (${free.length}室)</div>`;
    for (const r of free) {
      const here = peopleInRoom(r.room);
      const planned = plannersForRoom(r.room);
      const next = nextCoursesToday(r.room, state.semester, state.day, state.period);
      const nextStr =
        next.length > 0
          ? `次: ${next[0].period}限 ${truncate(next[0].course.name, 14)}`
          : "今日この後の授業なし";
      const tags = (r.tags || []).map(
        (t) => `<span class="badge tag">${t}</span>`
      ).join("");
      const bigBadge = r.kind === "big" ? `<span class="badge big">大教室</span>` : "";
      let peopleBadge = "";
      if (here > 0) peopleBadge = `<span class="badge friends">👥 ${here}人</span>`;
      else if (planned > 0) peopleBadge = `<span class="badge tag">予定 ${planned}</span>`;
      // 空きで人がいる場合、メイン行を「空き · 〇人いる」に変えて気づきやすく
      const mainLine = here > 0 ? `空き · 👥 ${here}人いる` : "空き";
      html += `
        <button class="list-item" data-room="${r.room}">
          <span class="dot free"></span>
          <span class="room-id">${r.room}</span>
          <span class="body">
            <span class="room-line">${mainLine}</span>
            <span class="room-meta">${nextStr}</span>
          </span>
          <span class="badges">
            ${peopleBadge}
            ${bigBadge}
            ${tags}
          </span>
        </button>
      `;
    }
    html += `</div>`;
  }

  if (busy.length) {
    html += `<div class="list-section">`;
    html += `<div class="list-section-head">授業中 (${busy.length}室)</div>`;
    for (const item of busy) {
      const r = item.room;
      const c = item.course;
      const friendsHere = friendsByRoom[r.room] || [];
      const tags = (r.tags || []).map(
        (t) => `<span class="badge tag">${t}</span>`
      ).join("");
      const bigBadge = r.kind === "big" ? `<span class="badge big">大教室</span>` : "";
      const friendsBadge =
        friendsHere.length > 0
          ? `<span class="badge friends">👥 ${friendsHere.length}</span>`
          : "";
      html += `
        <button class="list-item" data-room="${r.room}">
          <span class="dot busy"></span>
          <span class="room-id">${r.room}</span>
          <span class="body">
            <span class="room-line">${escapeHtml(truncate(c.name, 30))}</span>
            <span class="room-meta">${escapeHtml(truncate(c.professor, 24))}</span>
          </span>
          <span class="badges">
            ${friendsBadge}
            ${bigBadge}
            ${tags}
          </span>
        </button>
      `;
    }
    html += `</div>`;
  }

  const el = document.getElementById("content");
  el.innerHTML = html;
  el.querySelectorAll("[data-room]").forEach((b) => {
    b.addEventListener("click", () => openSheet(b.dataset.room));
  });
}

// === マップ表示: 横向き建物デフォルメ ===
// 各階を「N棟が上、W-C-E が下に横並び」のフロアプラン風に描画
function renderMapView() {
  const filteredRooms = filterRooms(ROOMS);
  if (!filteredRooms.length) {
    document.getElementById("content").innerHTML =
      `<div class="empty-state">該当する教室がありません</div>`;
    return;
  }
  // 階+ウィングでグルーピング
  const groups = {};
  for (const r of filteredRooms) {
    const f = r.floor === null ? "?" : r.floor;
    const fk = String(f);
    groups[fk] = groups[fk] || {};
    const w = r.wing || "?";
    groups[fk][w] = groups[fk][w] || [];
    groups[fk][w].push(r);
  }

  let html = "";
  // 階の並び順: 上層 → 下層（6F, 5F, ..., 1F, B1, B2）
  const floorKeys = Object.keys(groups).sort((a, b) => Number(b) - Number(a));
  for (const fk of floorKeys) {
    html += renderFloorPlan(fk, groups[fk]);
  }

  const el = document.getElementById("content");
  el.innerHTML = html;
  el.querySelectorAll("[data-room]").forEach((b) => {
    b.addEventListener("click", () => openSheet(b.dataset.room));
  });
}

function renderFloorPlan(floorKey, wingsMap) {
  const fNum = Number(floorKey);
  const label = fNum < 0 ? `B${Math.abs(fNum)}F` : `${floorKey}F`;
  const allRooms = Object.values(wingsMap).flat();
  const total = allRooms.length;
  const free = allRooms.filter((r) => !isBusy(r.room, state.semester, state.day, state.period)).length;

  const svg = renderFloorPlanSVG(floorKey, wingsMap);

  return `
    <div class="bldg-floor">
      <div class="bldg-floor-head">
        <span class="bldg-floor-label">${label}</span>
        <span class="bldg-floor-stat">空き ${free} / ${total}</span>
      </div>
      <div class="bldg-svg-wrap">
        ${svg}
      </div>
    </div>
  `;
}

/**
 * 茗荷谷キャンパス フロアプラン SVG レンダリング
 *
 * 各階のレイアウトは floors.js の FLOOR_LAYOUTS に座標で定義済み
 * - 公式キャンパスマップを近似した教室位置
 * - データに無い教室 (研究室など) は灰色で非クリック
 * - 学生食堂・ラウンジ・吹抜等の特殊エリアは色付きラベル
 */
function renderFloorPlanSVG(floorKey, wingsMap) {
  const layout = FLOOR_LAYOUTS[floorKey];
  if (!layout) {
    // レイアウト未定義の階は簡易グリッドにフォールバック
    return renderFallbackGrid(wingsMap);
  }
  return renderCustomLayout(floorKey, layout);
}

function renderCustomLayout(floorKey, layout) {
  // データ内の教室を高速参照できるよう Set 化
  const dataRoomMap = new Map(ROOMS.map((r) => [r.room, r]));

  let sectionsHTML = "";
  for (const sec of layout.sections || []) {
    sectionsHTML += `
      <g class="svg-section svg-section-${sec.kind}">
        <rect x="${sec.x}" y="${sec.y}" width="${sec.w}" height="${sec.h}" rx="4" />
        <text x="${sec.x + sec.w / 2}" y="${sec.y + sec.h / 2 + 4}" text-anchor="middle" class="section-label">${escapeHtml(sec.label)}</text>
      </g>
    `;
  }

  let cellsHTML = "";
  for (const [roomId, pos] of Object.entries(layout.rooms)) {
    if (pos.isHidden) continue;
    const dataKey = pos.dataRoom || roomId; // データの参照キー (3W01 → 3BIG 等)
    const isDataRoom = dataRoomMap.has(dataKey);
    let cls = "svg-room";
    let interactive = false;
    let courses = [];
    let here = 0;
    let isBig = false;
    let dataInfo = null;

    if (isDataRoom) {
      dataInfo = dataRoomMap.get(dataKey);
      courses = getRoomCourses(dataKey, state.semester, state.day, state.period);
      const busy = courses.length > 0;
      cls += busy ? " cell-busy" : " cell-free";
      isBig = dataInfo.kind === "big";
      if (isBig) cls += " cell-big";
      here = peopleInRoom(dataKey);
      interactive = true;
    } else {
      // データに無い教室 (研究室等)
      cls += " cell-disabled";
    }

    const cx = pos.x + pos.w / 2;
    const cy = pos.y + pos.h / 2;
    const fontSize = pos.w < 50 ? 10 : pos.w < 80 ? 12 : 14;
    const showText = pos.displayLabel || roomId;
    const subLabel = pos.dataRoom ? pos.dataRoom : "";
    // 回転 (Excalidraw からの角度・度数) - 矩形・友達ドットだけ回転、ラベルは水平を保つ
    const angle = pos.angle || 0;
    const rotateTransform = angle !== 0 ? ` transform="rotate(${angle} ${cx} ${cy})"` : "";

    cellsHTML += `
      <g${interactive ? ` data-room="${dataKey}"` : ""} class="${cls}">
        <g${rotateTransform}>
          <rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="4" />
          ${
            here > 0
              ? `<circle cx="${pos.x + pos.w - 11}" cy="${pos.y + 11}" r="9" class="svg-friend-dot"/>
                 <text x="${pos.x + pos.w - 11}" y="${pos.y + 14}" text-anchor="middle" style="font-size:11px;fill:white;font-weight:700;">${here}</text>`
              : ""
          }
        </g>
        <text x="${cx}" y="${cy + (subLabel ? -3 : fontSize / 3)}" text-anchor="middle" style="font-size:${fontSize}px;">${escapeHtml(showText)}</text>
        ${subLabel ? `<text x="${cx}" y="${cy + fontSize}" text-anchor="middle" style="font-size:${Math.max(8, fontSize - 4)}px;opacity:0.7;">${escapeHtml(subLabel)}</text>` : ""}
      </g>
    `;
  }

  const mainPath = layout.mainOutline || layout.outline || "";
  const annexPath = layout.annexOutline || "";
  return `
    <svg viewBox="${layout.viewBox}" xmlns="http://www.w3.org/2000/svg" class="floor-svg" preserveAspectRatio="xMidYMid meet">
      ${mainPath ? `<path d="${mainPath}" class="bldg-outline" />` : ""}
      ${annexPath ? `<path d="${annexPath}" class="bldg-outline bldg-outline-annex" />` : ""}
      ${sectionsHTML}
      ${cellsHTML}
    </svg>
  `;
}

// レイアウト未定義階のフォールバック (シンプルグリッド)
function renderFallbackGrid(wingsMap) {
  let html = '<svg viewBox="0 0 1000 420" xmlns="http://www.w3.org/2000/svg" class="floor-svg" preserveAspectRatio="xMidYMid meet">';
  html += '<rect x="50" y="50" width="900" height="320" rx="12" class="bldg-outline" />';
  let y = 80;
  for (const wingKey of ["N", "W", "C", "E"]) {
    const list = wingsMap[wingKey];
    if (!list || !list.length) continue;
    const sorted = list.slice().sort((a, b) => (a.number || 0) - (b.number || 0));
    html += `<text x="80" y="${y}" class="wing-svg-label">${wingKey}棟</text>`;
    let x = 200;
    for (const r of sorted) {
      const courses = getRoomCourses(r.room, state.semester, state.day, state.period);
      const busy = courses.length > 0;
      const cls = busy ? "cell-busy" : "cell-free";
      const here = peopleInRoom(r.room);
      html += `<g data-room="${r.room}" class="svg-room ${cls}">
        <rect x="${x}" y="${y - 18}" width="70" height="32" rx="4"/>
        <text x="${x + 35}" y="${y + 2}" text-anchor="middle" style="font-size:12px;">${r.room}</text>
        ${here > 0 ? `<circle cx="${x + 64}" cy="${y - 12}" r="6" class="svg-friend-dot"/><text x="${x + 64}" y="${y - 9}" text-anchor="middle" style="font-size:9px;fill:white;font-weight:700;">${here}</text>` : ""}
      </g>`;
      x += 78;
      if (x > 900) { x = 200; y += 40; }
    }
    y += 60;
  }
  html += '</svg>';
  return html;
}

function friendsLabel(roomId) {
  const fs = friendsInRoom(roomId);
  if (fs.length > 0) return `👥 ${fs.length}人`;
  return null;
}

// === フィルタ ===
function filterRooms(list) {
  return list.filter((r) => {
    // 6F は当面除外 (加山さん指示)
    if (r.floor === 6) return false;
    // 階
    if (state.floor !== "all") {
      const targetFloor = state.floor.startsWith("B") ? -Number(state.floor.slice(1)) : Number(state.floor);
      if (r.floor !== targetFloor) return false;
    }
    // フィルタ
    if (state.filter === "free") {
      if (isBusy(r.room, state.semester, state.day, state.period)) return false;
    } else if (state.filter === "friends") {
      if (!friendsInRoom(r.room).length) return false;
    } else if (state.filter.startsWith("wing-")) {
      const w = state.filter.slice(5);
      if (r.wing !== w) return false;
    }
    return true;
  });
}

// === シート (詳細) ===
function openSheet(roomId) {
  state.selectedRoom = roomId;
  const room = ROOMS.find((r) => r.room === roomId);
  if (!room) return;
  const courses = getRoomCourses(roomId, state.semester, state.day, state.period);
  const isCurrentlyBusy = courses.length > 0;
  const next = nextCoursesToday(roomId, state.semester, state.day, state.period);
  const friendsHere = friendsInRoom(roomId);
  const inMarker = state.myMarkers[roomId];

  const tagsHtml = (room.tags || []).map(
    (t) => `<span class="badge tag">${t}</span>`
  ).join("");

  const floorDisp = room.floor === null ? "?" : (room.floor < 0 ? `B${Math.abs(room.floor)}` : `${room.floor}F`);
  const membersStr = room.members && room.members.length > 0 ? ` <span class="badge tag">${room.members.join("+")}</span>` : "";
  const bigBadge = room.kind === "big" ? `<span class="badge big">大教室(結合)</span>` : "";

  let html = `
    <div class="sheet-title-row">
      <div>
        <div class="sheet-room-id">${room.room}</div>
        <div class="sheet-meta-line">
          <span>${floorDisp}</span>
          <span>${room.wing || "?"}棟</span>
          ${bigBadge}
          ${membersStr}
          ${tagsHtml}
        </div>
      </div>
      <div class="sheet-status-pill ${isCurrentlyBusy ? "busy" : "free"}">
        ${isCurrentlyBusy ? "授業中" : "空き"}
      </div>
    </div>
  `;

  if (isCurrentlyBusy) {
    const c = courses[0];
    html += `
      <div class="sheet-section">
        <div class="now-course-card">
          <div class="course-name">${escapeHtml(c.name)}</div>
          <div class="course-prof">${escapeHtml(c.professor)}</div>
          <div class="course-time">${PERIOD_TIMES[state.period][0]} – ${PERIOD_TIMES[state.period][1]}  ·  ${state.period}限</div>
        </div>
      </div>
    `;
    // 同授業の友達 (mock: 仮で1人だけ)
    const sameCourseFriends = friendsHere.filter(
      (f) => f.marker?.kind === "in" && getRoomCourses(roomId, state.semester, state.day, state.period).length > 0
    );
    html += `
      <div class="sheet-section">
        <div class="sheet-section-title">同じ授業の友達</div>
        ${
          sameCourseFriends.length
            ? `<div class="friend-list">${sameCourseFriends.map(friendRow).join("")}</div>`
            : `<div class="empty-mini">フォロー中の友達はこの授業を取っていません</div>`
        }
      </div>
    `;
  } else {
    // 自分のマーカー
    html += `
      <div class="sheet-section">
        <div class="sheet-section-title">いまの状況</div>
        <div style="display:flex; gap:10px; align-items:center;">
          <span class="badge friends">👥 ${friendsHere.length + (inMarker === "in" ? 1 : 0)}人</span>
          ${
            inMarker === "in"
              ? `<span style="font-size:12px; color:var(--free-deep); font-weight:600;">あなたが入室中</span>`
              : inMarker === "planned"
              ? `<span style="font-size:12px; color:var(--accent-deep); font-weight:600;">あなたが「使う予定」マーク中</span>`
              : ""
          }
        </div>
      </div>
    `;

    // いる友達
    html += `
      <div class="sheet-section">
        <div class="sheet-section-title">いる友達</div>
        ${
          friendsHere.length
            ? `<div class="friend-list">${friendsHere.map(friendRow).join("")}</div>`
            : `<div class="empty-mini">いまここに友達はいません</div>`
        }
      </div>
    `;

    // アクション
    html += `
      <div class="action-row">
        ${
          inMarker === "in"
            ? `<button class="action-btn exit" data-action="exit"><span data-icon="exit-room"></span> 退室する</button>`
            : `<button class="action-btn in-room" data-action="enter"><span data-icon="enter-room"></span> 入室する</button>`
        }
        <button class="action-btn ${inMarker === "planned" ? "primary" : "secondary"}" data-action="bookmark">
          <span data-icon="bookmark"></span>
          ${inMarker === "planned" ? "予約解除" : "使う予定 (仮)"}
        </button>
      </div>
    `;
  }

  // これからの予定
  html += `
    <div class="sheet-section">
      <div class="sheet-section-title">今日この後の予定</div>
      ${
        next.length > 0
          ? next
              .map(
                (n) => `
                <div class="timeline-item">
                  <div class="timeline-time">${n.period}限<br><span style="font-weight:500;">${PERIOD_TIMES[n.period][0]}</span></div>
                  <div class="timeline-content">
                    <div class="name">${escapeHtml(n.course.name)}</div>
                    <div class="prof">${escapeHtml(n.course.professor)}</div>
                  </div>
                </div>
              `
              )
              .join("")
          : `<div class="empty-mini">今日この後の授業はありません</div>`
      }
    </div>
  `;

  document.getElementById("sheet-content").innerHTML = html;
  injectIcons(document.getElementById("sheet-content"));

  // アクション
  document.getElementById("sheet-content").querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", () => handleAction(b.dataset.action, roomId));
  });

  document.getElementById("detail-sheet").setAttribute("aria-hidden", "false");
}

function closeSheet() {
  document.getElementById("detail-sheet").setAttribute("aria-hidden", "true");
  state.selectedRoom = null;
}

// 念のため: モバイルでスクロールロック（ボトムシート展開時に背面スクロール抑止）
function applyScrollLock() {
  const anySheetOpen = document.querySelectorAll('.sheet[aria-hidden="false"]').length > 0;
  document.body.style.overflow = anySheetOpen ? "hidden" : "";
}
// オブザーバーでシート状態を監視
new MutationObserver(applyScrollLock).observe(document.body, {
  attributes: true,
  subtree: true,
  attributeFilter: ["aria-hidden"],
});

function handleAction(action, roomId) {
  const cur = state.myMarkers[roomId];
  if (action === "enter") {
    state.myMarkers[roomId] = "in";
  } else if (action === "exit") {
    delete state.myMarkers[roomId];
  } else if (action === "bookmark") {
    if (cur === "planned") delete state.myMarkers[roomId];
    else state.myMarkers[roomId] = "planned";
  }
  saveMyMarkers();
  openSheet(roomId); // 再描画
  render();
}

function friendRow(f) {
  const kindLabel =
    f.marker?.kind === "in"
      ? '<span class="friend-meta">入室中</span>'
      : f.marker?.kind === "planned"
      ? '<span class="friend-meta">使う予定</span>'
      : '<span class="friend-meta">予定なし</span>';
  return `
    <div class="friend-row">
      <div class="friend-avatar">${f.name.slice(0, 1)}</div>
      <div class="friend-name">${f.name}</div>
      ${kindLabel}
    </div>
  `;
}

// === Utility ===
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function truncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

// Boot
init().catch((e) => {
  console.error(e);
  document.getElementById("content").innerHTML = `<div class="empty-state">読み込みエラー: ${escapeHtml(e.message)}</div>`;
});
