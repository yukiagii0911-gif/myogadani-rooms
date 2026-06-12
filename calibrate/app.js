// === キャリブレーションツール ===
// 各階のフロアプラン画像を背景にして、教室の位置・サイズ・角度をタップ＆ドラッグで設定
// 結果は localStorage に保存 + JSONエクスポート

const FLOORS = ["-1", "1", "2", "3", "5", "6"];
const FLOOR_LABELS = { "-1": "B1", "1": "1F", "2": "2F", "3": "3F", "5": "5F", "6": "6F" };

// 各階のデフォルト教室リスト（rooms.jsonに無いものも含む実物に合わせたリスト）
const FLOOR_ROOMS = {
  "-1": ["B1C16", "B1E04", "B1W01", "B1W02"],
  "1": ["1W01"],
  "2": ["2C02", "2C03", "2E02", "2E03", "2E04", "2E05", "2E06", "2E07", "2E08", "2W01", "2W02"],
  "3": [
    "3N02", "3N04", "3C02", "3C03", "3C13",
    "3E02", "3E03", "3E04", "3E05", "3E06", "3E07", "3E08", "3E09", "3E10",
    "3W01", "3W02"
  ],
  "5": [
    "5N01", "5N02", "5N03", "5N04", "5N05", "5N06",
    "5C02", "5C03", "5C04", "5C06", "5C08", "5C09", "5C10", "5C11",
    "5W01", "5W02", "5W03", "5W04", "5W05", "5W06", "5W07", "5W08", "5W09", "5W10"
  ],
  "6": [
    "6C03", "6C04", "6C05", "6C07", "6C08", "6C09", "6C10", "6C11",
    "6C12", "6C13", "6C14", "6C15", "6C16",
    "6W01", "6W02", "6W03", "6W04", "6W05", "6W06", "6W07", "6W08", "6W09", "6W10", "6W11", "6W12"
  ],
};

const STORAGE_KEY = "myogadani-calibration-v1";
const DEFAULT_ROOM_SIZE = { w: 60, h: 40 };

const state = {
  floor: "5",
  activeRoom: null,
  data: loadData(),
  dragRoom: null,
  dragStart: null,
  imgNatural: { w: 0, h: 0 },
};

// 初回起動時、加山さんが既に配置した B1・1F のデータを seed.json から読込
// (友達が初めて開いたとき、既に出来てる分が見える状態にする)
// 既存の自分の編集データは上書きしない (各階の rooms が空っぽなときだけ seed を当てる)
async function loadSeedIfNeeded() {
  try {
    const res = await fetch("./seed.json", { cache: "no-cache" });
    if (!res.ok) return;
    const seed = await res.json();
    let updated = false;
    for (const [floor, data] of Object.entries(seed)) {
      const cur = state.data[floor];
      const curRoomCount = cur && cur.rooms ? Object.keys(cur.rooms).length : 0;
      if (curRoomCount === 0) {
        state.data[floor] = state.data[floor] || { customRooms: [] };
        state.data[floor].rooms = data.rooms;
        updated = true;
      }
    }
    if (updated) {
      saveData();
      renderAll();
    }
  } catch {}
}

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function ensureFloor(f) {
  if (!state.data[f]) state.data[f] = { imageDataUrl: null, rooms: {}, customRooms: [] };
  if (!state.data[f].rooms) state.data[f].rooms = {};
  if (!state.data[f].customRooms) state.data[f].customRooms = [];
  return state.data[f];
}

function getFloorRoomList(f) {
  const base = FLOOR_ROOMS[f] || [];
  const custom = ensureFloor(f).customRooms || [];
  return [...base, ...custom];
}

// === DOM参照 ===
const $ = (id) => document.getElementById(id);
const imageWrap = $("image-wrap");
const imageEmpty = $("image-empty");
const overlay = $("overlay");
const floorTabs = $("floor-tabs");
const roomList = $("room-list");
const adjusters = $("adjusters");
const arName = $("ar-name");
const arStatus = $("ar-status");
const adjW = $("adj-w");
const adjH = $("adj-h");
const adjAngle = $("adj-angle");
const valW = $("val-w");
const valH = $("val-h");
const valAngle = $("val-angle");
const toast = $("toast");

// === Floor tabs ===
function renderFloorTabs() {
  floorTabs.innerHTML = FLOORS.map((f) => {
    const total = getFloorRoomList(f).length;
    const done = Object.keys(ensureFloor(f).rooms).length;
    const on = state.floor === f ? " on" : "";
    return `<button class="floor-tab${on}" data-floor="${f}">${FLOOR_LABELS[f]}<span class="done-count">${done}/${total}</span></button>`;
  }).join("");
}

floorTabs.addEventListener("click", (e) => {
  const t = e.target.closest("[data-floor]");
  if (!t) return;
  state.floor = t.dataset.floor;
  state.activeRoom = null;
  renderAll();
});

// === Image upload ===
$("image-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const f = ensureFloor(state.floor);
    f.imageDataUrl = reader.result;
    saveData();
    renderImage();
  };
  reader.readAsDataURL(file);
});


async function renderImage() {
  const f = ensureFloor(state.floor);
  // 古いimg/svg要素を削除
  imageWrap.querySelectorAll("img, .bg-svg").forEach((el) => el.remove());

  // 1. ユーザーアップロード画像があればそれを使用
  if (f.imageDataUrl) {
    return renderImageFromUrl(f.imageDataUrl);
  }

  // 2. 全階共通の外形SVGを背景に使用
  try {
    const res = await fetch(`./outlines/outline.svg`);
    if (res.ok) {
      const svgText = await res.text();
      return renderOutlineSvg(svgText);
    }
  } catch {}

  // 3. 外形がなければエラー表示
  imageEmpty.style.display = "block";
  $("image-empty-msg").textContent = `外形が読み込めません`;
  overlay.setAttribute("viewBox", "0 0 100 100");
}

function renderImageFromUrl(url) {
  imageEmpty.style.display = "none";
  const img = document.createElement("img");
  img.src = url;
  img.onload = () => {
    state.imgNatural = { w: img.naturalWidth, h: img.naturalHeight };
    overlay.setAttribute("viewBox", `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
    renderOverlay();
  };
  // overlay の前に挿入して教室が前面に出るようにする
  imageWrap.insertBefore(img, overlay);
}

function renderOutlineSvg(svgText) {
  imageEmpty.style.display = "none";
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const srcSvg = doc.querySelector("svg");
  const vb = srcSvg.getAttribute("viewBox").split(/\s+/).map(Number);
  state.imgNatural = { w: vb[2], h: vb[3], vbX: vb[0], vbY: vb[1] };
  const wrapper = document.createElement("div");
  wrapper.className = "bg-svg";
  wrapper.innerHTML = svgText;
  // overlay より前に挿入 → 教室は前面表示
  imageWrap.insertBefore(wrapper, overlay);
  overlay.setAttribute("viewBox", `${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`);
  renderOverlay();
}

// === Overlay rendering ===
// 矩形はrotateするが、教室名ラベルは常に水平を保つ（2段グループ構造）
function renderOverlay() {
  const f = ensureFloor(state.floor);
  let html = "";
  for (const [name, pos] of Object.entries(f.rooms)) {
    const cls = name === state.activeRoom ? "room-cell active" : "room-cell";
    const cx = pos.x + pos.w / 2;
    const cy = pos.y + pos.h / 2;
    const rotateTransform = pos.angle ? ` transform="rotate(${pos.angle} ${cx} ${cy})"` : "";
    html += `
      <g class="room-group" data-name="${name}">
        <g${rotateTransform}>
          <rect class="${cls}" x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="3" />
        </g>
        <text class="room-label" x="${cx}" y="${cy + 4}" text-anchor="middle">${name}</text>
      </g>
    `;
  }
  overlay.innerHTML = html;
}

// === Active room ===
function setActiveRoom(name) {
  state.activeRoom = name;
  renderActive();
  renderOverlay();
  renderRoomList();
}

function renderActive() {
  if (!state.activeRoom) {
    arName.textContent = "教室を選んでください ↓";
    arStatus.textContent = "下のリストからタップ";
    adjusters.hidden = true;
    overlay.classList.remove("placing");
    return;
  }
  arName.textContent = state.activeRoom;
  const f = ensureFloor(state.floor);
  const pos = f.rooms[state.activeRoom];
  if (!pos) {
    arStatus.textContent = "画像をタップして配置 →";
    adjusters.hidden = true;
    overlay.classList.add("placing");
  } else {
    arStatus.textContent = "ドラッグで移動・スライダーで調整";
    adjusters.hidden = false;
    overlay.classList.remove("placing");
    adjW.value = pos.w; valW.textContent = pos.w;
    adjH.value = pos.h; valH.textContent = pos.h;
    adjAngle.value = pos.angle || 0; valAngle.textContent = `${pos.angle || 0}°`;
  }
}

// === Room list ===
function renderRoomList() {
  const f = ensureFloor(state.floor);
  const rooms = getFloorRoomList(state.floor);
  roomList.innerHTML = rooms.map((name) => {
    const done = !!f.rooms[name];
    const active = name === state.activeRoom;
    return `<li data-name="${name}" class="${done ? "done" : ""} ${active ? "active" : ""}">${name}</li>`;
  }).join("");
}

roomList.addEventListener("click", (e) => {
  const li = e.target.closest("[data-name]");
  if (!li) return;
  setActiveRoom(li.dataset.name);
});

// === Add custom room ===
$("btn-add-custom").addEventListener("click", () => {
  const name = prompt("教室名を入力 (例: 5C05)");
  if (!name) return;
  const f = ensureFloor(state.floor);
  if (!f.customRooms.includes(name) && !(FLOOR_ROOMS[state.floor] || []).includes(name)) {
    f.customRooms.push(name);
  }
  setActiveRoom(name);
  saveData();
  renderRoomList();
});

// === Place / drag rectangle on overlay ===
overlay.addEventListener("pointerdown", (e) => {
  if (!state.activeRoom) return;
  const f = ensureFloor(state.floor);
  const pt = svgPoint(e);
  const target = e.target.closest("g.room-group");

  if (target && f.rooms[target.dataset.name]) {
    // 既存の矩形をドラッグ開始
    state.dragRoom = target.dataset.name;
    state.dragStart = pt;
    state.dragOrigin = { ...f.rooms[target.dataset.name] };
    if (target.dataset.name !== state.activeRoom) {
      setActiveRoom(target.dataset.name);
    }
    overlay.setPointerCapture(e.pointerId);
  } else if (overlay.classList.contains("placing")) {
    // 新規配置
    const w = DEFAULT_ROOM_SIZE.w;
    const h = DEFAULT_ROOM_SIZE.h;
    f.rooms[state.activeRoom] = {
      x: Math.round(pt.x - w / 2),
      y: Math.round(pt.y - h / 2),
      w, h, angle: 0,
    };
    saveData();
    overlay.classList.remove("placing");
    renderOverlay();
    renderActive();
    renderRoomList();
    renderFloorTabs();
    showToast(`${state.activeRoom} 配置`);
  }
});

overlay.addEventListener("pointermove", (e) => {
  if (!state.dragRoom) return;
  const pt = svgPoint(e);
  const dx = pt.x - state.dragStart.x;
  const dy = pt.y - state.dragStart.y;
  const f = ensureFloor(state.floor);
  const pos = f.rooms[state.dragRoom];
  pos.x = Math.round(state.dragOrigin.x + dx);
  pos.y = Math.round(state.dragOrigin.y + dy);
  renderOverlay();
});

overlay.addEventListener("pointerup", (e) => {
  if (state.dragRoom) {
    overlay.releasePointerCapture?.(e.pointerId);
    state.dragRoom = null;
    saveData();
  }
});

function svgPoint(e) {
  const rect = overlay.getBoundingClientRect();
  const vb = overlay.viewBox.baseVal;
  const scaleX = vb.width / rect.width;
  const scaleY = vb.height / rect.height;
  const scale = Math.max(scaleX, scaleY); // contain (meet)
  const offsetX = (rect.width * scale - vb.width) / 2;
  const offsetY = (rect.height * scale - vb.height) / 2;
  return {
    x: (e.clientX - rect.left) * scale - offsetX + vb.x,
    y: (e.clientY - rect.top) * scale - offsetY + vb.y,
  };
}

// === Adjusters ===
adjW.addEventListener("input", () => updateActive("w", +adjW.value));
adjH.addEventListener("input", () => updateActive("h", +adjH.value));
adjAngle.addEventListener("input", () => updateActive("angle", +adjAngle.value));

document.querySelectorAll(".quick-rotate button").forEach((b) => {
  b.addEventListener("click", () => {
    const f = ensureFloor(state.floor);
    const pos = f.rooms[state.activeRoom];
    if (!pos) return;
    if (b.dataset.rot === "0") pos.angle = 0;
    else pos.angle = (pos.angle || 0) + Number(b.dataset.rot);
    pos.angle = Math.round(pos.angle);
    saveData();
    adjAngle.value = pos.angle;
    valAngle.textContent = `${pos.angle}°`;
    renderOverlay();
  });
});

function updateActive(key, value) {
  const f = ensureFloor(state.floor);
  const pos = f.rooms[state.activeRoom];
  if (!pos) return;
  pos[key] = value;
  saveData();
  if (key === "w") valW.textContent = value;
  if (key === "h") valH.textContent = value;
  if (key === "angle") valAngle.textContent = `${value}°`;
  renderOverlay();
}

// === Actions ===
$("btn-delete").addEventListener("click", () => {
  if (!state.activeRoom) return;
  const f = ensureFloor(state.floor);
  delete f.rooms[state.activeRoom];
  saveData();
  renderOverlay();
  renderRoomList();
  renderActive();
  renderFloorTabs();
  showToast(`${state.activeRoom} 削除`);
});

$("btn-next").addEventListener("click", () => {
  const rooms = getFloorRoomList(state.floor);
  const f = ensureFloor(state.floor);
  const idx = rooms.indexOf(state.activeRoom);
  // 次の未配置を探す
  for (let i = idx + 1; i < rooms.length; i++) {
    if (!f.rooms[rooms[i]]) {
      setActiveRoom(rooms[i]);
      return;
    }
  }
  // 全部終わってたら最初の未配置に
  const firstUnplaced = rooms.find((r) => !f.rooms[r]);
  if (firstUnplaced) setActiveRoom(firstUnplaced);
  else showToast("この階すべて配置済み");
});

// === Export ===
$("btn-export").addEventListener("click", async () => {
  const f = ensureFloor(state.floor);
  const out = {
    floor: state.floor,
    floorLabel: FLOOR_LABELS[state.floor],
    imageNatural: state.imgNatural,
    rooms: f.rooms,
  };
  const text = JSON.stringify(out, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showToast("JSON コピーしました");
  } catch (err) {
    // Fallback: prompt
    prompt("コピー用JSON", text);
  }
});

// === Toast ===
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
}

// === Render all ===
function renderAll() {
  renderFloorTabs();
  renderImage();
  renderRoomList();
  renderActive();
}

// Init
renderAll();
loadSeedIfNeeded();
