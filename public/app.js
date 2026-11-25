const $ = id => document.getElementById(id);
const layout = document.querySelector('.layout');
const columns = 'abcdefghi';
const codePattern = /^[2-9A-HJ-NP-Z]{8}$/;
const archivePattern = /^[a-f0-9]{36}$/;
const labels = {
  r: { k: '帥', a: '仕', b: '相', n: '馬', r: '車', c: '炮', p: '兵' },
  b: { k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' }
};
const initial = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
const reasons = { resigned: '认输', checkmate: '将死', stalemate: '困毙', draw: '和棋', agreedDraw: '双方同意', timeout: '对方超时' };
const handicaps = { horse: '单马', horses: '双马', rook: '单车', 'rook-horse': '车马', rooks: '双车' };
const offerLabels = { undo: '悔棋', draw: '求和' };
const home = new URL('./', location.href);
const endpoints = new URL('api/', home);
const colorName = side => side === 'r' ? '红方' : '黑方';
const roomQuery = code => '?room=' + code;
const replayQuery = id => '?replay=' + id;

let page = 'lobby';
let code = '';
let room = null;
let source = null;
let connected = false;
let selected = '';
let pending = false;
let navigation = 0;
let replay = null;
let step = 0;
let roomToReturn = '';
let toastTimer;
let clockReceivedAt = 0;
let clockServerNow = 0;
let recordedList = '';
const cells = [];

function getSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); }
  catch { /* The game remains usable when browser storage is restricted. */ }
}

function say(text = '') {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

function toast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 3500);
}

async function request(path, body) {
  const options = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  };
  const response = await fetch(new URL(path, endpoints), { ...options, signal: AbortSignal.timeout(8000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
  return data;
}

function showError(error) {
  say(error.status ? error.message : '连接失败，请检查网络后重试。');
}

function settingsLabel(settings) {
  const time = settings.minutes ? '每方 ' + settings.minutes + ' 分钟' : '不限时';
  const handicap = settings.handicap === 'none' ? '不让子' : colorName(settings.giver) + '让' + handicaps[settings.handicap];
  const opening = settings.openingHandicap ? colorName(settings.first) + '先走 ' + settings.opening + ' 步' : '红方先行';
  return [time, handicap, opening].join(' · ');
}

function choosePage(next) {
  page = next;
  for (const id of ['lobby', 'invited', 'room', 'replay']) $(id).hidden = id !== next;
  layout.classList.toggle('in-room', next === 'room');
  layout.classList.toggle('in-replay', next === 'replay');
  layout.classList.remove('waiting');
  $('title').textContent = next === 'replay' ? '棋局复盘' : '中国象棋';
  $('top-player').hidden = $('bottom-player').hidden = next !== 'room';
  say();
  toast('');
}

function stopRoom() {
  source?.close();
  source = null;
  room = null;
  selected = '';
  connected = false;
}

function setLocation(search, replace = false) {
  const url = new URL(search || './', home);
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

function openRoom(data) {
  code = data.code;
  save('moon-xq-recent', code);
  choosePage('room');
  $('invite-link').value = new URL(roomQuery(code), home).href;
  updateRoom(data);
  const stream = new EventSource(new URL('rooms/' + code + '/events', endpoints));
  source = stream;
  stream.onmessage = event => {
    if (source !== stream) return;
    connected = true;
    updateRoom(JSON.parse(event.data));
  };
  stream.onerror = () => {
    if (source !== stream) return;
    connected = false;
    selected = '';
    renderRoom();
    if (stream.readyState === EventSource.CLOSED) {
      say('连接已关闭。可刷新页面重新入座。');
    }
  };
}

function updateRoom(data) {
  if (room && data.version < room.version) return;
  if (!room || room.version !== data.version || room.side !== data.side) selected = '';
  room = data;
  clockReceivedAt = performance.now();
  clockServerNow = data.serverNow;
  if (data.archives.length) {
    const items = new Map([...getSaved('moon-xq-archives', []), ...data.archives]
      .map(item => [item.id, item]));
    save('moon-xq-archives', [...items.values()].sort((a, b) => b.finished - a.finished).slice(0, 250));
  }
  renderRoom();
}

async function navigate() {
  const visit = ++navigation;
  stopRoom();
  replay = null;
  const params = new URLSearchParams(location.search);
  const archiveId = params.get('replay');
  code = (params.get('room') || '').toUpperCase();
  choosePage('lobby');
  $('resume').hidden = !codePattern.test(getSaved('moon-xq-recent', ''));
  renderBoard(initial);
  showMoves([]);
  if (archiveId) {
    if (!archivePattern.test(archiveId)) return say('复盘链接无效。');
    try {
      const data = await request('archives/' + archiveId);
      if (visit !== navigation) return;
      replay = data;
      step = 0;
      choosePage('replay');
      $('download').href = new URL('archives/' + replay.id + '/download', endpoints).href;
      $('replay-settings').textContent = replay.settings ? settingsLabel(replay.settings) : '';
      $('replay-back').textContent = roomToReturn ? '返回对局' : '返回大厅';
      renderReplay();
    } catch (error) {
      if (visit === navigation) showError(error);
    }
    return;
  }
  if (!code) return;
  if (!codePattern.test(code)) return say('房号格式有误，请检查邀请链接。');
  choosePage('invited');
  $('accept').disabled = true;
  $('invitation-settings').hidden = true;
  $('invitation-label').textContent = '正在查找房间 ' + code + '…';
  try {
    const data = await request('rooms/' + code);
    if (visit === navigation) openRoom(data);
  } catch (error) {
    if (visit !== navigation) return;
    if (error.status !== 401) {
      showError(error);
      $('invitation-label').textContent = '房间 ' + code;
      return;
    }
    try {
      const info = await request('rooms/' + code + '/info');
      if (visit !== navigation) return;
      $('invitation-label').textContent = '好友邀请你加入房间 ' + code + '。';
      $('invitation-settings').textContent = settingsLabel(info.settings);
      $('invitation-settings').hidden = false;
      $('accept').disabled = info.joined;
      if (info.joined) say('两个席位已坐满。');
      renderBoard(info.fen, true);
    } catch (infoError) {
      if (visit === navigation) showError(infoError);
    }
  }
}

function changePage(search) {
  setLocation(search);
  return navigate();
}

async function enter(target) {
  if (pending) return;
  const visit = navigation;
  const path = target ? 'rooms/' + target + '/join' : 'rooms';
  pending = true;
  $('create').disabled = $('accept').disabled = true;
  say();
  try {
    const [first, opening] = $('setting-first').value;
    const options = {
      minutes: Number($('setting-time').value), handicap: $('setting-handicap').value,
      giver: $('setting-giver').value, first, opening: Number(opening)
    };
    const data = await request(path, target ? {} : options);
    if (visit !== navigation) return;
    setLocation(roomQuery(data.code));
    openRoom(data);
  } catch (error) {
    if (visit === navigation) showError(error);
  } finally {
    pending = false;
    $('create').disabled = $('accept').disabled = false;
  }
}

function drawLines() {
  const canvas = $('lines');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = devicePixelRatio;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / 900, 0, 0, canvas.height / 1000, 0, 0);
  ctx.strokeStyle = '#654522';
  ctx.lineWidth = 2;
  const line = (col, row, endCol, endRow) => {
    ctx.moveTo(50 + col * 100, 50 + row * 100);
    ctx.lineTo(50 + endCol * 100, 50 + endRow * 100);
  };
  ctx.beginPath();
  for (let row = 0; row < 10; row++) line(0, row, 8, row);
  for (let col = 0; col < 9; col++) {
    line(col, 0, col, col === 0 || col === 8 ? 9 : 4);
    if (col > 0 && col < 8) line(col, 5, col, 9);
  }
  for (const start of [0, 7]) {
    line(3, start, 5, start + 2);
    line(5, start, 3, start + 2);
  }
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeRect(45, 45, 810, 910);
}

function boardPieces(fen) {
  const squares = new Map();
  fen.split(' ')[0].split('/').forEach((rank, row) => {
    let col = 0;
    for (const piece of rank) {
      if (piece >= '1' && piece <= '9') col += Number(piece);
      else squares.set(columns[col++] + (9 - row), piece);
    }
  });
  return squares;
}

function renderBoard(fen, flipped = false, move = null, destinations = []) {
  const squares = boardPieces(fen);
  const interactive = page === 'room' && Boolean(room?.joined);
  const keyboard = cells.findIndex(cell => cell.tabIndex === 0);
  for (const [index, cell] of cells.entries()) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const square = flipped ? columns[8 - col] + row : columns[col] + (9 - row);
    const piece = squares.get(square);
    const side = piece && (piece === piece.toUpperCase() ? 'r' : 'b');
    const label = piece ? labels[side][piece.toLowerCase()] : '';
    cell.dataset.square = square;
    cell.textContent = label;
    cell.className = 'cell';
    cell.classList.toggle('piece', Boolean(piece));
    cell.classList.toggle('red', side === 'r');
    cell.classList.toggle('selected', square === selected);
    cell.classList.toggle('target', destinations.includes(square));
    cell.classList.toggle('trail', square === move?.from || square === move?.to);
    cell.setAttribute('aria-label', square + ' ' + (label ? colorName(side) + label : '空位'));
    cell.setAttribute('aria-pressed', String(square === selected));
    cell.tabIndex = interactive && index === (keyboard < 0 ? 76 : keyboard) ? 0 : -1;
  }
  $('squares').inert = !interactive;
}

function moveLabel(move) {
  return labels[move.color][move.piece.toLowerCase()] + ' ' + move.from + '–' + move.to;
}

function showMoves(moves, current = 0) {
  const clickable = page === 'replay';
  $('scoresheet').hidden = !moves.length;
  const key = clickable + ':' + moves.map(move => move.color + move.from + move.to).join('');
  if (key !== recordedList) {
    recordedList = key;
    const items = document.createDocumentFragment();
    let li;
    let row = 0;
    for (const [index, move] of moves.entries()) {
      if (!li || move.color === 'r' || moves[index - 1]?.color === 'b') {
        li = document.createElement('li');
        const number = document.createElement('span');
        number.textContent = ++row + '.';
        li.append(number);
        items.append(li);
      }
      const item = document.createElement(clickable ? 'button' : 'span');
      item.textContent = moveLabel(move);
      item.className = move.color === 'r' ? 'move-red' : 'move-black';
      if (clickable) {
        item.type = 'button';
        item.dataset.step = index + 1;
        item.addEventListener('click', () => seek(Number(item.dataset.step)));
      }
      li.append(item);
    }
    $('moves').replaceChildren(items);
    if (!clickable) $('moves').scrollTop = $('moves').scrollHeight;
  }
  if (clickable) {
    for (const item of $('moves').querySelectorAll('button')) {
      if (Number(item.dataset.step) === current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
  }
}

function renderPlayer(id, side) {
  const el = $(id);
  const present = room.online[side];
  const seated = side === 'r' || room.joined;
  const active = room.joined && !room.result && room.turn === side;
  const text = document.createElement('span');
  text.textContent = colorName(side) + (room.side === side ? ' · 你' : '');
  const status = document.createElement('span');
  status.textContent = !seated ? '空席' : present ? (active ? '● 行棋中' : '● 在线') : '○ 离线';
  el.classList.toggle('current', active);
  el.replaceChildren(text, status);
  if (room.clock) {
    const clock = document.createElement('time');
    clock.className = 'player-clock';
    clock.dataset.clock = side;
    el.append(clock);
  }
}

function resultLabel(result) {
  if (!result.winner) return result.reason === 'agreedDraw' ? '和棋 · 双方同意' : '和棋';
  return colorName(result.winner) + '胜 · ' + reasons[result.reason];
}

function renderClocks() {
  const clock = room?.clock;
  if (!clock) return;
  const estimate = clockServerNow + performance.now() - clockReceivedAt;
  for (const ticker of document.querySelectorAll('[data-clock]')) {
    const running = ticker.dataset.clock === clock.turn && clock.deadline !== null;
    const ms = running ? clock.deadline - estimate : clock.remaining[ticker.dataset.clock];
    const seconds = Math.ceil(Math.max(ms, 0) / 1000);
    ticker.textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    ticker.classList.toggle('low', running && seconds <= 10);
  }
}

function renderOffer() {
  const { offer, feedback } = room;
  const playing = room.joined && !room.result;
  const mine = offer?.from === room.side;
  $('play-tools').hidden = !playing;
  $('undo').disabled = !connected || Boolean(offer) || !room.moves.some(move => move.color === room.side);
  $('draw').disabled = !connected || Boolean(offer);
  $('offer').hidden = !offer;
  $('offer-decline').hidden = $('offer-accept').hidden = mine;
  $('offer-cancel').hidden = !mine;
  for (const id of ['offer-accept', 'offer-decline', 'offer-cancel']) $(id).disabled = !connected;
  if (offer) {
    const kind = offerLabels[offer.kind];
    $('offer-text').textContent = (mine ? '已申请' + kind + '，等待对方确认。' : '对方申请' + kind + '。') +
      (offer.kind === 'undo' ? ' 同意后，回到申请方上一次走子前。' : '');
    $('offer-accept').textContent = '同意' + kind;
  }
  $('offer-feedback').hidden = !feedback;
  if (feedback) {
    const messages = { accept: '已同意', decline: '已拒绝', cancel: '已撤回', expired: '因新走子而失效' };
    $('offer-feedback').textContent = offerLabels[feedback.kind] + '申请' + messages[feedback.decision] + '。';
  }
}

function renderRoom() {
  if (!room) return;
  layout.classList.toggle('waiting', !room.joined);
  const playing = room.joined && !room.result;
  const myTurn = playing && room.side === room.turn;
  const ready = room.ready.includes(room.side);
  $('room-number').textContent = '房号 ' + room.code + ' · 第 ' + room.round + ' 局';
  $('room-settings').textContent = settingsLabel(room.settings);
  $('connection').textContent = connected ? '● 实时连接' : '○ 正在重连';
  $('phase').textContent = room.result ? resultLabel(room.result)
    : !room.joined ? '等待好友入座' : myTurn ? '轮到你走' : '轮到对方走';
  const opposite = room.side === 'r' ? 'b' : 'r';
  $('detail').textContent = room.result
    ? ready ? '已同意再战，等待对方确认。' : '棋谱已保存。双方确认后换边再战。'
    : !room.joined ? '把链接或房号发给好友。好友入座后开局。'
    : room.check ? colorName(room.turn) + '被将军。'
    : room.openingLeft > 1 ? colorName(room.turn) + '开局还可连走 ' + room.openingLeft + ' 步。'
    : !room.online[opposite] ? '对方暂时离线，重新打开房间链接即可继续。'
    : myTurn ? '点选棋子，再点目标位置。' : '对方正在思考。';
  $('invite-tools').hidden = room.joined;
  $('round-tools').hidden = !room.result;
  $('rematch').textContent = ready ? '等待对方确认' : '再来一局';
  $('rematch').disabled = ready || !connected;
  $('resign').hidden = !playing;
  $('resign').disabled = !connected;
  renderPlayer('top-player', opposite);
  renderPlayer('bottom-player', room.side);
  renderClocks();
  renderOffer();
  const destinations = myTurn && selected ? room.legal.filter(([from]) => from === selected).map(([, to]) => to) : [];
  renderBoard(room.fen, room.side === 'b', room.moves.at(-1), destinations);
  showMoves(room.moves);
}

async function action(name, extra = {}) {
  if (!room || !connected || pending) return;
  pending = true;
  say();
  const visit = navigation;
  try {
    const data = await request('rooms/' + room.code + '/' + name, {
      version: room.version, round: room.round, ...extra
    });
    if (visit === navigation && room && data.version > room.version) updateRoom(data);
  } catch (error) {
    if (visit === navigation) showError(error);
  } finally {
    pending = false;
  }
}

function selectSquare(square) {
  if (!room || !connected || pending || room.side !== room.turn || !room.joined || room.result) return;
  say();
  const canMove = room.legal.some(([from, to]) => from === selected && to === square);
  if (canMove) {
    const from = selected;
    selected = '';
    renderRoom();
    void action('move', { from, to: square });
    return;
  }
  const piece = boardPieces(room.fen).get(square);
  const ownPiece = piece && (piece === piece.toUpperCase() ? 'r' : 'b') === room.side;
  selected = selected !== square && ownPiece ? square : '';
  renderRoom();
}

function renderReplay() {
  const last = replay.moves.length;
  $('replay-result').textContent = resultLabel(replay.result) + ' · 第 ' + replay.round + ' 局';
  $('timeline').max = last;
  $('timeline').value = step;
  $('timeline').setAttribute('aria-valuetext', '第 ' + step + ' 步，共 ' + last + ' 步');
  $('step-count').value = step + ' / ' + last;
  $('first').disabled = $('prev').disabled = step === 0;
  $('last').disabled = $('next').disabled = step === last;
  renderBoard(replay.positions[step], false, replay.moves[step - 1]);
  showMoves(replay.moves, step);
}

function seek(index) {
  if (!replay) return;
  step = Math.max(0, Math.min(replay.moves.length, index));
  renderReplay();
}

function review(id) {
  roomToReturn = room?.code || roomToReturn;
  void changePage(replayQuery(id));
}

async function copy(value, input) {
  try {
    await navigator.clipboard.writeText(value);
    toast('已复制，可以发给好友。');
  } catch {
    if (input) {
      input.focus();
      input.select();
      toast('链接已选中，请手动复制。');
    } else {
      toast('请从浏览器地址栏复制复盘链接。');
    }
  }
}

function showArchives() {
  const items = getSaved('moon-xq-archives', []);
  $('archive-empty').hidden = Boolean(items.length);
  $('archives').replaceChildren(...items.map(item => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const time = document.createElement('span');
    time.textContent = new Date(item.finished).toLocaleString('zh-CN');
    button.type = 'button';
    button.textContent = '房间 ' + item.code + ' · 第 ' + item.round + ' 局';
    button.append(time);
    button.addEventListener('click', () => {
      $('archive-dialog').close();
      review(item.id);
    });
    li.append(button);
    return li;
  }));
  $('archive-dialog').showModal();
}

for (let index = 0; index < 90; index++) {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.tabIndex = -1;
  cell.style.setProperty('--x', (Math.round((index % 9 + 0.5) / 9 * 10000) / 100) + '%');
  cell.style.setProperty('--y', (Math.floor(index / 9) * 10 + 5) + '%');
  cell.addEventListener('click', () => selectSquare(cell.dataset.square));
  cell.addEventListener('keydown', event => {
    const directions = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    if ((delta === -1 && index % 9 === 0) || (delta === 1 && index % 9 === 8)) return;
    const next = cells[index + delta];
    if (!next) return;
    cell.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });
  cells.push(cell);
  $('squares').append(cell);
}
new ResizeObserver(drawLines).observe($('lines'));
$('create-form').addEventListener('submit', event => {
  event.preventDefault();
  void enter();
});
$('setting-handicap').addEventListener('change', () => {
  $('giver-field').hidden = $('setting-handicap').value === 'none';
});
$('accept').addEventListener('click', () => enter(code));
$('join-form').addEventListener('submit', event => {
  event.preventDefault();
  const target = $('code').value.trim().toUpperCase();
  if (!codePattern.test(target)) return say('请输入好友给你的 8 位房号。');
  void changePage(roomQuery(target));
});
$('resume').addEventListener('click', () => changePage(roomQuery(getSaved('moon-xq-recent', ''))));
$('copy-invite').addEventListener('click', () => copy($('invite-link').value, $('invite-link')));
$('copy-invite').setAttribute('aria-label', '复制邀请链接');
$('resign').addEventListener('click', () => {
  $('confirm-resign').returnValue = '';
  $('confirm-resign').showModal();
});
$('confirm-resign').addEventListener('close', () => {
  if ($('confirm-resign').returnValue === 'resign') void action('resign');
});
$('rematch').addEventListener('click', () => action('rematch'));
$('undo').addEventListener('click', () => action('offer', { kind: 'undo' }));
$('draw').addEventListener('click', () => action('offer', { kind: 'draw' }));
for (const decision of ['accept', 'decline', 'cancel']) {
  $('offer-' + decision).addEventListener('click', () => action('respond', { decision }));
}
$('review').addEventListener('click', () => review(room.archiveId));
$('history').addEventListener('click', showArchives);
$('first').addEventListener('click', () => seek(0));
$('prev').addEventListener('click', () => seek(step - 1));
$('next').addEventListener('click', () => seek(step + 1));
$('last').addEventListener('click', () => seek(replay.moves.length));
$('timeline').addEventListener('input', event => seek(Number(event.target.value)));
$('share-replay').addEventListener('click', () => copy(new URL(replayQuery(replay.id), home).href));
for (const id of ['back', 'invite-back', 'replay-back']) $(id).addEventListener('click', () => {
  const destination = id === 'replay-back' && roomToReturn ? roomQuery(roomToReturn) : '';
  roomToReturn = '';
  void changePage(destination);
});
window.addEventListener('popstate', navigate);
setInterval(renderClocks, 200);
void navigate();
