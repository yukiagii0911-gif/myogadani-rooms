// === キャリブレーションツール (Konva版) ===
// 各階の外形を背景に、教室矩形を Konva Stage に配置・編集
// Transformer で隅ドラッグ・回転ハンドル付き

// 6F は当面除外 (必要になったら "6" を再追加)
const FLOORS = ["-1", "1", "2", "3", "5"];
const FLOOR_LABELS = { "-1": "B1", "1": "1F", "2": "2F", "3": "3F", "5": "5F" };

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
const DEFAULT_ROOM = { w: 60, h: 40, angle: 0 };

const state = {
  floor: "5",
  activeRoom: null,
  data: loadData(),
  viewBox: null,
  stage: null,
  bgLayer: null,
  roomLayer: null,
  transformer: null,
  selectedNode: null,
  outlineImage: null,
};

function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }

function ensureFloor(f) {
  if (!state.data[f]) state.data[f] = { rooms: {}, customRooms: [] };
  if (!state.data[f].rooms) state.data[f].rooms = {};
  if (!state.data[f].customRooms) state.data[f].customRooms = [];
  return state.data[f];
}

function getFloorRoomList(f) {
  return [...(FLOOR_ROOMS[f] || []), ...(ensureFloor(f).customRooms || [])];
}

const $ = (id) => document.getElementById(id);
const floorTabs = $("floor-tabs");
const roomList = $("room-list");
const adjusters = $("ar-actions");
const arName = $("ar-name");
const arStatus = $("ar-status");
const imageEmpty = $("image-empty");
const toast = $("toast");

// === Floor tabs ===
function renderFloorTabs() {
  floorTabs.innerHTML = FLOORS.map((f) => {
    const total = getFloorRoomList(f).length;
    const done = Object.keys(ensureFloor(f).rooms).length;
    const on = state.floor === f ? " on" : "";
    return `<button class="floor-tab${on}" data-floor="${f}">${FLOOR_LABELS[f]}<span class="done-count">${done}/${total}</span></button>`;
  }).join("");
  renderHint();
}
floorTabs.addEventListener("click", (e) => {
  const t = e.target.closest("[data-floor]");
  if (!t) return;
  state.floor = t.dataset.floor;
  state.activeRoom = null;
  state.selectedNode = null;
  renderAll();
});

// === 外形SVGロード ===
async function loadOutlineSvg() {
  const res = await fetch("./outlines/outline.svg?v=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("外形SVG読込失敗");
  const svgText = await res.text();
  // viewBox を取り出す
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const srcSvg = doc.querySelector("svg");
  const vb = srcSvg.getAttribute("viewBox").split(/\s+/).map(Number);
  // Image オブジェクトとして読み込む
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
  });
  return { img, vb };
}

// === Stage 初期化 ===
async function initStage() {
  imageEmpty.hidden = true;
  // 既存ステージを破棄
  if (state.stage) { state.stage.destroy(); state.stage = null; }

  try {
    const { img, vb } = await loadOutlineSvg();
    state.viewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    state.outlineImage = img;
  } catch (e) {
    imageEmpty.hidden = false;
    $("image-empty-msg").textContent = "外形読み込み失敗";
    return;
  }

  const container = $("konva-container");
  const containerRect = container.getBoundingClientRect();

  // Stage は viewBox のサイズに合わせる。CSS で見た目を 100% にする
  const stage = new Konva.Stage({
    container: "konva-container",
    width: state.viewBox.w,
    height: state.viewBox.h,
  });

  // 背景レイヤ (外形)
  const bgLayer = new Konva.Layer({ listening: false });
  const bgImg = new Konva.Image({
    x: 0,
    y: 0,
    width: state.viewBox.w,
    height: state.viewBox.h,
    image: state.outlineImage,
  });
  bgLayer.add(bgImg);
  stage.add(bgLayer);

  // 教室レイヤ
  const roomLayer = new Konva.Layer();
  stage.add(roomLayer);

  // Transformer (選択中の教室につける)
  const transformer = new Konva.Transformer({
    rotateEnabled: true,
    enabledAnchors: [
      "top-left", "top-center", "top-right",
      "middle-left", "middle-right",
      "bottom-left", "bottom-center", "bottom-right",
    ],
    rotationSnaps: [0, 5, 10, 15, 20, 25, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, -5, -10, -15, -20, -25, -30, -45, -60, -75, -90, -105, -120, -135, -150, -165],
    rotationSnapTolerance: 4,
    borderStroke: "#5c9fd0",
    borderStrokeWidth: 2,
    anchorStroke: "#5c9fd0",
    anchorFill: "#fff",
    anchorSize: 12,
    anchorCornerRadius: 6,
    keepRatio: false,
  });
  roomLayer.add(transformer);

  // Stage クリックで新規配置 or 選択解除
  stage.on("click tap", (e) => {
    if (e.target === stage || e.target.getClassName() === "Image") {
      // 背景タップ
      if (state.activeRoom) {
        const f = ensureFloor(state.floor);
        if (!f.rooms[state.activeRoom]) {
          // 新規配置 (タップ位置を中心に)
          // スクリーン座標を viewBox 座標に逆変換
          const sp = stage.getPointerPosition();
          const scale = state.scale || 1;
          const pad = state.pad || { x: 0, y: 0 };
          const vbCx = (sp.x - pad.x) / scale;
          const vbCy = (sp.y - pad.y) / scale;
          const w = DEFAULT_ROOM.w, h = DEFAULT_ROOM.h;
          const ox = state.viewBox.x;
          const oy = state.viewBox.y;
          f.rooms[state.activeRoom] = {
            x: Math.round(vbCx - w / 2 + ox),
            y: Math.round(vbCy - h / 2 + oy),
            w, h, angle: 0,
          };
          saveData();
          renderRooms();
          renderActive();
          renderRoomList();
          renderFloorTabs();
          showToast(`${state.activeRoom} 配置`);
          selectRoom(state.activeRoom);
        } else {
          // 既配置 → 選択解除
          deselectRoom();
        }
      }
    }
  });

  state.stage = stage;
  state.bgLayer = bgLayer;
  state.roomLayer = roomLayer;
  state.transformer = transformer;

  // レイアウト確定後に Layer の scale/position を計算
  const tryFit = () => {
    const r = container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      requestAnimationFrame(tryFit);
    } else {
      fitStageToContainer(stage, container);
    }
  };
  tryFit();
  window.addEventListener("resize", () => fitStageToContainer(stage, container));

  renderRooms();
}

function fitStageToContainer(stage, container) {
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const sx = rect.width / state.viewBox.w;
  const sy = rect.height / state.viewBox.h;
  const scale = Math.min(sx, sy);
  const w = state.viewBox.w * scale;
  const h = state.viewBox.h * scale;
  state.scale = scale;
  state.pad = { x: (rect.width - w) / 2, y: (rect.height - h) / 2 };
  stage.width(rect.width);
  stage.height(rect.height);
  // 背景画像の表示サイズも合わせて更新
  if (state.bgLayer) {
    const bg = state.bgLayer.findOne("Image");
    if (bg) {
      bg.x(state.pad.x);
      bg.y(state.pad.y);
      bg.width(w);
      bg.height(h);
    }
    state.bgLayer.batchDraw();
  }
  // 教室は座標が変わるので再描画
  if (state.roomLayer) renderRooms();
  stage.batchDraw();
}

// === 教室レンダ ===
// 全座標を「スクリーン座標」で扱う。viewBox 座標 → スクリーン座標 への変換は
// state.scale, state.pad を使う。Konva の Stage/Layer scale は 1 のまま。
// (Konva.Transformer は Stage/Layer scale を考慮しないため、手動 scale が必要)
function renderRooms() {
  if (!state.roomLayer) return;
  state.transformer.nodes([]);
  // name="room" の Group のみ destroy。Transformer は Konva.Group 継承なので
  // find("Group") で巻き込まれてしまう → name で限定する。
  state.roomLayer.find(".room").forEach((n) => n.destroy());
  state.roomLayer.find("Text").forEach((n) => n.destroy());
  state.selectedNode = null;

  const f = ensureFloor(state.floor);
  const ox = state.viewBox.x;
  const oy = state.viewBox.y;
  const scale = state.scale || 1;
  const pad = state.pad || { x: 0, y: 0 };

  for (const [name, pos] of Object.entries(f.rooms)) {
    // viewBox 座標 → スクリーン座標
    const sw = pos.w * scale;
    const sh = pos.h * scale;
    const scx = ((pos.x - ox) + pos.w / 2) * scale + pad.x;
    const scy = ((pos.y - oy) + pos.h / 2) * scale + pad.y;

    const group = new Konva.Group({
      x: scx,
      y: scy,
      rotation: pos.angle || 0,
      draggable: true,
      name: "room",
    });
    group.setAttr("roomName", name);
    const rect = new Konva.Rect({
      x: -sw / 2,
      y: -sh / 2,
      width: sw,
      height: sh,
      fill: "#b2f2bb",
      stroke: "#2e6b3a",
      strokeWidth: 2,
      cornerRadius: 4,
    });
    group.add(rect);

    const label = new Konva.Text({
      text: name,
      fontSize: 11,
      fontFamily: "system-ui, -apple-system, 'Hiragino Sans', sans-serif",
      fontStyle: "bold",
      fill: "#3a332d",
      stroke: "#ffffff",
      strokeWidth: 3,
      fillAfterStrokeEnabled: true,
      listening: false,
    });
    label.x(scx - label.width() / 2);
    label.y(scy - label.height() / 2);
    label.setAttr("forRoom", name);

    group.on("click tap", (e) => {
      e.cancelBubble = true;
      selectRoom(name);
    });
    group.on("dragmove", () => {
      label.x(group.x() - label.width() / 2);
      label.y(group.y() - label.height() / 2);
    });
    group.on("transform", () => {
      const sx = group.scaleX();
      const sy = group.scaleY();
      if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
        const nw = Math.max(10, rect.width() * sx);
        const nh = Math.max(10, rect.height() * sy);
        rect.width(nw);
        rect.height(nh);
        rect.x(-nw / 2);
        rect.y(-nh / 2);
        group.scaleX(1);
        group.scaleY(1);
      }
      label.x(group.x() - label.width() / 2);
      label.y(group.y() - label.height() / 2);
    });
    group.on("dragend transformend", () => {
      // スクリーン座標 → viewBox 座標 に逆変換して保存
      const vbW = rect.width() / scale;
      const vbH = rect.height() / scale;
      const vbCx = (group.x() - pad.x) / scale;
      const vbCy = (group.y() - pad.y) / scale;
      const d = ensureFloor(state.floor);
      d.rooms[name] = {
        x: Math.round(vbCx - vbW / 2 + ox),
        y: Math.round(vbCy - vbH / 2 + oy),
        w: Math.round(vbW),
        h: Math.round(vbH),
        angle: Math.round(group.rotation() * 10) / 10,
      };
      saveData();
    });

    state.roomLayer.add(group);
    state.roomLayer.add(label);
  }
  state.roomLayer.batchDraw();

  if (state.activeRoom) {
    selectRoom(state.activeRoom);
  }
}

function selectRoom(name) {
  state.activeRoom = name;
  const rect = state.roomLayer.findOne((n) => n.getAttr("roomName") === name);
  if (rect) {
    state.transformer.nodes([rect]);
    state.selectedNode = rect;
    rect.moveToTop();
    // ラベルを上に持ってくる
    state.roomLayer.find("Text").forEach((t) => {
      if (t.getAttr("forRoom") === name) t.moveToTop();
    });
    state.roomLayer.add(state.transformer);
    state.transformer.moveToTop();
  } else {
    state.transformer.nodes([]);
    state.selectedNode = null;
  }
  state.roomLayer.batchDraw();
  renderActive();
  renderRoomList();
}

function deselectRoom() {
  state.activeRoom = null;
  state.transformer.nodes([]);
  state.selectedNode = null;
  state.roomLayer.batchDraw();
  renderActive();
  renderRoomList();
}

function renderActive() {
  if (!state.activeRoom) {
    arName.textContent = "教室を選んで →";
    arStatus.textContent = "下のリストからタップ";
    adjusters.hidden = true;
    return;
  }
  arName.textContent = state.activeRoom;
  const f = ensureFloor(state.floor);
  if (f.rooms[state.activeRoom]) {
    arStatus.textContent = "ハンドルで変形・移動";
    adjusters.hidden = false;
  } else {
    arStatus.textContent = "画像をタップで配置";
    adjusters.hidden = true;
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
  selectRoom(li.dataset.name);
});

// === 教室追加 ===
$("btn-add-custom").addEventListener("click", () => {
  const name = prompt("教室名を入力 (例: 5C05)");
  if (!name) return;
  const f = ensureFloor(state.floor);
  if (!f.customRooms.includes(name) && !(FLOOR_ROOMS[state.floor] || []).includes(name)) {
    f.customRooms.push(name);
  }
  saveData();
  renderRoomList();
  selectRoom(name);
});

// === アクション ===
$("btn-delete").addEventListener("click", () => {
  if (!state.activeRoom) return;
  const f = ensureFloor(state.floor);
  delete f.rooms[state.activeRoom];
  saveData();
  renderRooms();
  renderActive();
  renderRoomList();
  renderFloorTabs();
  showToast(`${state.activeRoom} 削除`);
});
$("btn-next").addEventListener("click", () => {
  const rooms = getFloorRoomList(state.floor);
  const f = ensureFloor(state.floor);
  const idx = rooms.indexOf(state.activeRoom);
  for (let i = idx + 1; i < rooms.length; i++) {
    if (!f.rooms[rooms[i]]) { selectRoom(rooms[i]); return; }
  }
  const firstUnplaced = rooms.find((r) => !f.rooms[r]);
  if (firstUnplaced) selectRoom(firstUnplaced);
  else showToast("この階すべて配置済み");
});

// === Export ===
$("btn-export").addEventListener("click", async () => {
  const f = ensureFloor(state.floor);
  const out = {
    floor: state.floor,
    floorLabel: FLOOR_LABELS[state.floor],
    rooms: f.rooms,
  };
  const text = JSON.stringify(out, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showToast("JSON コピーしました");
  } catch {
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

// === Render all (階切替時) ===
function renderAll() {
  renderFloorTabs();
  renderRooms();
  renderRoomList();
  renderActive();
}

// === Seed 読込 ===
async function loadSeedIfNeeded() {
  try {
    const res = await fetch("./seed.json", { cache: "no-cache" });
    if (!res.ok) return;
    const seed = await res.json();
    let updated = false;
    for (const [floor, data] of Object.entries(seed)) {
      const cur = state.data[floor];
      const curCount = cur && cur.rooms ? Object.keys(cur.rooms).length : 0;
      if (curCount === 0) {
        state.data[floor] = state.data[floor] || { customRooms: [] };
        state.data[floor].rooms = data.rooms;
        updated = true;
      }
    }
    if (updated) {
      saveData();
      if (state.stage) renderRooms();
      renderFloorTabs();
      renderRoomList();
    }
  } catch {}
}

// 配置数が最大の階を返す(無ければ null)
function pickInitialFloor() {
  let best = null;
  let max = 0;
  for (const f of FLOORS) {
    const c = state.data[f] && state.data[f].rooms ? Object.keys(state.data[f].rooms).length : 0;
    if (c > max) { max = c; best = f; }
  }
  return best;
}

// 進捗ヒントの更新
function renderHint() {
  const hint = document.getElementById("cal-hint");
  if (!hint) return;
  let total = 0, done = 0;
  for (const f of FLOORS) {
    total += getFloorRoomList(f).length;
    done += state.data[f] && state.data[f].rooms ? Object.keys(state.data[f].rooms).length : 0;
  }
  hint.textContent = `B1・1F は手本済み。他の階の教室を配置してください (全体 ${done}/${total})`;
}

// Init
(async () => {
  // 1. seed を先にマージ(stage がない状態で state.data に入れるだけ)
  await loadSeedIfNeeded();
  // 2. 配置済みの階があればそこを初期表示にする(無ければデフォルトのまま)
  const initial = pickInitialFloor();
  if (initial) state.floor = initial;
  // 3. Stage は一度だけ作る
  await initStage();
  // 4. 描画
  renderAll();
  renderHint();
})();
