(function () {
  "use strict";

  const COLS = 20;          // 横向格子数
  const ROWS = 20;          // 纵向格子数
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const CELL = canvas.width / COLS;

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ov-title");
  const ovText = document.getElementById("ov-text");
  const ovBtn = document.getElementById("ov-btn");

  const STATE = { READY: "ready", RUNNING: "running", PAUSED: "paused", OVER: "over" };

  let state = STATE.READY;
  let snake, dir, nextDir, food, score, best, timer, speed;

  best = Number(localStorage.getItem("snake-best") || 0);
  bestEl.textContent = best;

  function reset() {
    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0;
    speed = 140;
    scoreEl.textContent = "0";
    placeFood();
    draw();
  }

  function placeFood() {
    const occupied = new Set(snake.map(s => s.x + "," + s.y));
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!occupied.has(x + "," + y)) free.push({ x, y });
      }
    }
    food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  function startLoop() {
    clearInterval(timer);
    timer = setInterval(tick, speed);
  }

  function start() {
    reset();
    state = STATE.RUNNING;
    overlay.classList.add("hidden");
    startLoop();
  }

  function togglePause() {
    if (state === STATE.RUNNING) {
      state = STATE.PAUSED;
      clearInterval(timer);
      showOverlay("已暂停", "按空格键或点击按钮继续游戏", "继续");
    } else if (state === STATE.PAUSED) {
      state = STATE.RUNNING;
      overlay.classList.add("hidden");
      startLoop();
    }
  }

  function showOverlay(title, text, btn) {
    ovTitle.textContent = title;
    ovText.textContent = text;
    ovBtn.textContent = btn;
    overlay.classList.remove("hidden");
  }

  function gameOver() {
    state = STATE.OVER;
    clearInterval(timer);
    if (score > best) {
      best = score;
      localStorage.setItem("snake-best", best);
      bestEl.textContent = best;
    }
    showOverlay("游戏结束", "本局得分：" + score + " 分 · 最高分：" + best, "再来一局");
  }

  function tick() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // 撞墙
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) return gameOver();

    // 撞自己（尾巴即将移动的格子允许通过）
    for (let i = 0; i < snake.length - 1; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) return gameOver();
    }

    snake.unshift(head);

    if (food && head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = score;
      placeFood();
      // 每吃 5 个加速一次
      if (score % 50 === 0 && speed > 60) {
        speed -= 12;
        startLoop();
      }
    } else {
      snake.pop();
    }

    draw();
  }

  function draw() {
    // 背景棋盘
    ctx.fillStyle = "#0a0f1c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.022)";
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }

    // 食物
    if (food) {
      const cx = food.x * CELL + CELL / 2;
      const cy = food.y * CELL + CELL / 2;
      ctx.save();
      ctx.shadowColor = "#ff6b6b";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#ff6b6b";
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 蛇身
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const pad = i === 0 ? 1 : 2;
      const t = i / Math.max(snake.length - 1, 1);
      ctx.fillStyle = i === 0 ? "#b9ffbe" : mix("#4fbf65", "#2b7a3d", t);
      if (i === 0) {
        ctx.save();
        ctx.shadowColor = "#7ee787";
        ctx.shadowBlur = 14;
      }
      roundRect(s.x * CELL + pad, s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, i === 0 ? 6 : 4);
      ctx.fill();
      if (i === 0) ctx.restore();
    }

    // 蛇眼
    if (snake.length) drawEyes();
  }

  function drawEyes() {
    const h = snake[0];
    const cx = h.x * CELL + CELL / 2;
    const cy = h.y * CELL + CELL / 2;
    const off = CELL * 0.18;
    const r = Math.max(1.6, CELL * 0.09);
    let e1, e2;
    if (dir.x !== 0) {
      e1 = { x: cx + dir.x * off, y: cy - off };
      e2 = { x: cx + dir.x * off, y: cy + off };
    } else {
      e1 = { x: cx - off, y: cy + dir.y * off };
      e2 = { x: cx + off, y: cy + dir.y * off };
    }
    ctx.fillStyle = "#0a0f1c";
    [e1, e2].forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function mix(a, b, t) {
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
    return "rgb(" + c.join(",") + ")";
  }

  // ---------- 输入 ----------
  const KEYS = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }
  };

  document.addEventListener("keydown", function (e) {
    const d = KEYS[e.key];
    if (d) {
      e.preventDefault();
      // 禁止 180° 掉头
      if (d.x === -dir.x && d.y === -dir.y) return;
      if (state === STATE.READY || state === STATE.OVER) start();
      nextDir = d;
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      togglePause();
    } else if (e.key === "r" || e.key === "R") {
      start();
    }
  });

  ovBtn.addEventListener("click", function () {
    if (state === STATE.PAUSED) togglePause();
    else start();
  });

  reset();
})();
