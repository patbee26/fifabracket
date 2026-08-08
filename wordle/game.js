(function () {
  "use strict";

  const ROWS = 6;
  const COLS = 5;
  const LS = {
    state: "wordle:state",
    stats: "wordle:stats",
    theme: "wordle:theme",
    hard: "wordle:hard",
    seenHelp: "wordle:seenHelp"
  };

  const WORDS = window.WORDLE_WORDS;

  // ---- DOM ----
  const boardEl = document.getElementById("board");
  const keyboardEl = document.getElementById("keyboard");
  const toaster = document.getElementById("toaster");

  // ---- Game state ----
  let state; // { answer, guesses: [], evals: [], done, won, mode: 'daily'|'random', dayNumber }
  let current = ""; // in-progress guess
  let stats;
  let hardMode = false;
  let busy = false; // during reveal animation

  // ---------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------
  function todayEpochDay() {
    // Days since a fixed epoch, in the player's local time.
    const now = new Date();
    const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const EPOCH = new Date(2021, 5, 19); // Wordle launch-ish
    return Math.round((local - EPOCH) / 86400000);
  }

  function dailyAnswer(dayNumber) {
    const list = WORDS.answers;
    return list[((dayNumber % list.length) + list.length) % list.length];
  }

  function randomAnswer() {
    const list = WORDS.answers;
    return list[Math.floor(Math.random() * list.length)];
  }

  function toast(msg, ms) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    toaster.appendChild(el);
    if (ms !== 0) {
      setTimeout(function () {
        el.style.transition = "opacity 0.3s";
        el.style.opacity = "0";
        setTimeout(function () { el.remove(); }, 300);
      }, ms || 1200);
    }
    return el;
  }

  // Evaluate a guess against the answer -> array of 'correct'|'present'|'absent'
  function evaluate(guess, answer) {
    const res = new Array(COLS).fill("absent");
    const counts = {};
    for (let i = 0; i < COLS; i++) counts[answer[i]] = (counts[answer[i]] || 0) + 1;
    // First pass: correct
    for (let i = 0; i < COLS; i++) {
      if (guess[i] === answer[i]) {
        res[i] = "correct";
        counts[guess[i]]--;
      }
    }
    // Second pass: present
    for (let i = 0; i < COLS; i++) {
      if (res[i] === "correct") continue;
      const g = guess[i];
      if (counts[g] > 0) {
        res[i] = "present";
        counts[g]--;
      }
    }
    return res;
  }

  // ---------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------
  function defaultStats() {
    return { played: 0, wins: 0, curStreak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], lastDay: null };
  }

  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(LS.stats));
      if (s && Array.isArray(s.dist)) return s;
    } catch (e) {}
    return defaultStats();
  }

  function saveStats() {
    try { localStorage.setItem(LS.stats, JSON.stringify(stats)); } catch (e) {}
  }

  function saveState() {
    try { localStorage.setItem(LS.state, JSON.stringify(state)); } catch (e) {}
  }

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(LS.state));
      if (s && s.answer) return s;
    } catch (e) {}
    return null;
  }

  function newDailyState() {
    const day = todayEpochDay();
    return {
      answer: dailyAnswer(day),
      guesses: [],
      evals: [],
      done: false,
      won: false,
      mode: "daily",
      dayNumber: day
    };
  }

  function newRandomState() {
    return {
      answer: randomAnswer(),
      guesses: [],
      evals: [],
      done: false,
      won: false,
      mode: "random",
      dayNumber: null
    };
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function buildBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.row = r;
      for (let c = 0; c < COLS; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.row = r;
        tile.dataset.col = c;
        tile.setAttribute("role", "img");
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  function getTile(r, c) {
    return boardEl.querySelector('.tile[data-row="' + r + '"][data-col="' + c + '"]');
  }

  function renderCompletedRows() {
    // Draw already-submitted guesses with their evaluations (no animation).
    for (let r = 0; r < state.guesses.length; r++) {
      const g = state.guesses[r];
      const ev = state.evals[r];
      for (let c = 0; c < COLS; c++) {
        const tile = getTile(r, c);
        tile.textContent = g[c].toUpperCase();
        tile.classList.add("filled", ev[c]);
        tile.setAttribute("aria-label", g[c] + " " + ev[c]);
      }
    }
  }

  function renderCurrent() {
    const r = state.guesses.length;
    if (r >= ROWS) return;
    for (let c = 0; c < COLS; c++) {
      const tile = getTile(r, c);
      if (c < current.length) {
        tile.textContent = current[c].toUpperCase();
        tile.classList.add("filled");
      } else {
        tile.textContent = "";
        tile.classList.remove("filled");
      }
    }
  }

  const KB_ROWS = ["qwertyuiop", "asdfghjkl", "↵zxcvbnm⌫"];
  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    KB_ROWS.forEach(function (rowStr, idx) {
      const row = document.createElement("div");
      row.className = "kb-row";
      for (const ch of rowStr) {
        const key = document.createElement("button");
        key.className = "key";
        key.type = "button";
        if (ch === "↵") { key.textContent = "Enter"; key.dataset.key = "Enter"; key.classList.add("wide"); }
        else if (ch === "⌫") { key.textContent = "⌫"; key.dataset.key = "Backspace"; key.classList.add("wide"); }
        else { key.textContent = ch; key.dataset.key = ch; }
        row.appendChild(key);
      }
      keyboardEl.appendChild(row);
    });
  }

  // Precedence for key coloring: correct > present > absent
  function paintKeyboard() {
    const best = {};
    const rank = { absent: 0, present: 1, correct: 2 };
    for (let r = 0; r < state.guesses.length; r++) {
      const g = state.guesses[r];
      const ev = state.evals[r];
      for (let c = 0; c < COLS; c++) {
        const ch = g[c];
        if (!(ch in best) || rank[ev[c]] > rank[best[ch]]) best[ch] = ev[c];
      }
    }
    keyboardEl.querySelectorAll(".key").forEach(function (key) {
      const ch = key.dataset.key;
      key.classList.remove("correct", "present", "absent");
      if (ch && ch.length === 1 && best[ch]) key.classList.add(best[ch]);
    });
  }

  // ---------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------
  function onKey(k) {
    if (busy || state.done) return;
    if (k === "Enter") return submit();
    if (k === "Backspace") {
      if (current.length > 0) { current = current.slice(0, -1); renderCurrent(); }
      return;
    }
    if (/^[a-z]$/.test(k) && current.length < COLS) {
      current += k;
      renderCurrent();
    }
  }

  function shakeCurrentRow(msg) {
    const r = state.guesses.length;
    const row = boardEl.querySelector('.row[data-row="' + r + '"]');
    if (row) {
      row.classList.add("shake");
      setTimeout(function () { row.classList.remove("shake"); }, 500);
    }
    if (msg) toast(msg);
  }

  // Enforce hard mode: revealed hints must be reused.
  function hardModeViolation(guess) {
    if (state.guesses.length === 0) return null;
    const lastG = state.guesses[state.guesses.length - 1];
    const lastE = state.evals[state.evals.length - 1];
    const ordinal = ["1st", "2nd", "3rd", "4th", "5th"];
    // Correct letters must stay in place.
    for (let i = 0; i < COLS; i++) {
      if (lastE[i] === "correct" && guess[i] !== lastG[i]) {
        return ordinal[i] + " letter must be " + lastG[i].toUpperCase();
      }
    }
    // Present letters must appear somewhere.
    for (let i = 0; i < COLS; i++) {
      if (lastE[i] === "present" && guess.indexOf(lastG[i]) === -1) {
        return "Guess must contain " + lastG[i].toUpperCase();
      }
    }
    return null;
  }

  function submit() {
    if (current.length < COLS) return shakeCurrentRow("Not enough letters");
    if (!WORDS.isValid(current)) return shakeCurrentRow("Not in word list");
    if (hardMode) {
      const v = hardModeViolation(current);
      if (v) return shakeCurrentRow(v);
    }

    const guess = current;
    const ev = evaluate(guess, state.answer);
    const r = state.guesses.length;

    state.guesses.push(guess);
    state.evals.push(ev);
    current = "";
    saveState();

    revealRow(r, guess, ev, function () {
      paintKeyboard();
      const won = guess === state.answer;
      if (won || state.guesses.length === ROWS) {
        finish(won, r);
      }
    });
  }

  function revealRow(r, guess, ev, done) {
    busy = true;
    let i = 0;
    (function step() {
      if (i >= COLS) {
        busy = false;
        if (done) done();
        return;
      }
      const tile = getTile(r, i);
      tile.textContent = guess[i].toUpperCase();
      tile.classList.add("filled", "reveal");
      // Color at the flip midpoint.
      setTimeout(function () {
        tile.classList.add(ev[i]);
        tile.setAttribute("aria-label", guess[i] + " " + ev[i]);
      }, 250);
      tile.addEventListener("animationend", function handler() {
        tile.removeEventListener("animationend", handler);
        tile.classList.remove("reveal");
      });
      i++;
      setTimeout(step, 300);
    })();
  }

  // ---------------------------------------------------------------
  // Win / lose
  // ---------------------------------------------------------------
  function finish(won, lastRow) {
    state.done = true;
    state.won = won;
    saveState();
    recordStats(won);

    if (won) {
      const row = boardEl.querySelector('.row[data-row="' + lastRow + '"]');
      if (row) {
        setTimeout(function () { row.classList.add("win"); }, 100);
      }
      const praise = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];
      toast(praise[state.guesses.length - 1] || "Well done", 1500);
    } else {
      toast(state.answer.toUpperCase(), 0);
    }
    setTimeout(function () { openStats(); }, won ? 1600 : 1400);
  }

  function recordStats(won) {
    // Only the daily puzzle updates streaks; random games don't.
    if (state.mode !== "daily") {
      stats.played++;
      if (won) { stats.wins++; stats.dist[state.guesses.length - 1]++; }
      saveStats();
      return;
    }
    // Avoid double-counting if somehow finished twice.
    if (stats.lastDay === state.dayNumber) return;
    stats.played++;
    if (won) {
      stats.wins++;
      stats.dist[state.guesses.length - 1]++;
      if (stats.lastDay === state.dayNumber - 1) stats.curStreak++;
      else stats.curStreak = 1;
      if (stats.curStreak > stats.maxStreak) stats.maxStreak = stats.curStreak;
    } else {
      stats.curStreak = 0;
    }
    stats.lastDay = state.dayNumber;
    saveStats();
  }

  // ---------------------------------------------------------------
  // Stats modal + share + countdown
  // ---------------------------------------------------------------
  let countdownTimer = null;

  function renderStats() {
    document.getElementById("st-played").textContent = stats.played;
    const winPct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    document.getElementById("st-win").textContent = winPct;
    document.getElementById("st-streak").textContent = stats.curStreak;
    document.getElementById("st-max").textContent = stats.maxStreak;

    const distEl = document.getElementById("dist");
    distEl.innerHTML = "";
    const max = Math.max(1, ...stats.dist);
    const highlightRow = state.done && state.won ? state.guesses.length : -1;
    for (let i = 0; i < 6; i++) {
      const rowDiv = document.createElement("div");
      rowDiv.className = "dist-row";
      const g = document.createElement("div");
      g.className = "g";
      g.textContent = i + 1;
      const bar = document.createElement("div");
      bar.className = "dist-bar" + (i + 1 === highlightRow ? " hot" : "");
      const pct = (stats.dist[i] / max) * 100;
      bar.style.width = Math.max(8, pct) + "%";
      bar.textContent = stats.dist[i];
      rowDiv.appendChild(g);
      rowDiv.appendChild(bar);
      distEl.appendChild(rowDiv);
    }

    const endPanel = document.getElementById("end-panel");
    if (state.done) {
      endPanel.style.display = "block";
      startCountdown();
    } else {
      endPanel.style.display = "none";
    }
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    const el = document.getElementById("countdown");
    function tick() {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
      let diff = Math.max(0, Math.floor((midnight - now) / 1000));
      const h = String(Math.floor(diff / 3600)).padStart(2, "0");
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
      const s = String(diff % 60).padStart(2, "0");
      el.textContent = h + ":" + m + ":" + s;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function shareText() {
    const emoji = { correct: "🟩", present: "🟨", absent: "⬛" };
    const emojiDark = { correct: "🟩", present: "🟨", absent: "⬜" };
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const pal = isDark ? emoji : emojiDark;
    const title = state.mode === "daily" ? "Wordle " + state.dayNumber : "Wordle (random)";
    const score = state.won ? state.guesses.length : "X";
    const hard = hardMode ? "*" : "";
    let out = title + " " + score + "/6" + hard + "\n\n";
    for (const ev of state.evals) {
      out += ev.map(function (e) { return pal[e]; }).join("") + "\n";
    }
    return out.trimEnd();
  }

  function doShare() {
    const text = shareText();
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("Copied results to clipboard"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied results to clipboard"); }
    catch (e) { toast("Couldn't copy"); }
    ta.remove();
  }

  // ---------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------
  function openOverlay(id) { document.getElementById(id).classList.add("show"); }
  function closeOverlay(id) { document.getElementById(id).classList.remove("show"); }

  function openStats() {
    renderStats();
    openOverlay("stats-overlay");
  }

  function fillExample(id, letters, evals) {
    const row = document.getElementById(id);
    row.innerHTML = "";
    for (let i = 0; i < letters.length; i++) {
      const tile = document.createElement("div");
      tile.className = "tile filled" + (evals[i] ? " " + evals[i] : "");
      tile.textContent = letters[i];
      row.appendChild(tile);
    }
  }

  function buildExamples() {
    fillExample("ex1", "WEARY", ["correct", "", "", "", ""]);
    fillExample("ex2", "PILLS", ["", "present", "", "", ""]);
    fillExample("ex3", "VAGUE", ["", "", "", "absent", ""]);
  }

  // ---------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]').setAttribute(
      "content", theme === "dark" ? "#121213" : "#ffffff"
    );
    const darkToggle = document.getElementById("dark-toggle");
    if (darkToggle) darkToggle.checked = theme === "dark";
    try { localStorage.setItem(LS.theme, theme); } catch (e) {}
  }

  function initTheme() {
    let theme;
    try { theme = localStorage.getItem(LS.theme); } catch (e) {}
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(theme);
  }

  // ---------------------------------------------------------------
  // New games
  // ---------------------------------------------------------------
  function startRandomGame() {
    state = newRandomState();
    current = "";
    buildBoard();
    paintKeyboard();
    saveState();
    closeOverlay("settings-overlay");
    closeOverlay("stats-overlay");
    toast("New game — good luck!");
  }

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------
  function wire() {
    // Physical keyboard
    document.addEventListener("keydown", function (e) {
      if (document.querySelector(".overlay.show")) {
        if (e.key === "Escape") document.querySelectorAll(".overlay.show").forEach(function (o) { o.classList.remove("show"); });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "Enter" || k === "Backspace") { onKey(k); e.preventDefault(); }
      else if (/^[a-zA-Z]$/.test(k)) onKey(k.toLowerCase());
    });

    // On-screen keyboard
    keyboardEl.addEventListener("click", function (e) {
      const key = e.target.closest(".key");
      if (key) onKey(key.dataset.key);
    });

    // Header buttons
    document.getElementById("help-btn").addEventListener("click", function () { openOverlay("help-overlay"); });
    document.getElementById("stats-btn").addEventListener("click", openStats);
    document.getElementById("theme-btn").addEventListener("click", function () {
      const cur = document.documentElement.getAttribute("data-theme");
      applyTheme(cur === "dark" ? "light" : "dark");
    });

    // Long-press / right-click theme button opens settings (also expose via title)
    document.getElementById("theme-btn").addEventListener("contextmenu", function (e) {
      e.preventDefault();
      openOverlay("settings-overlay");
    });

    // Close buttons + overlay backdrop
    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.closest(".overlay").classList.remove("show");
      });
    });
    document.querySelectorAll(".overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) {
        if (e.target === ov) ov.classList.remove("show");
      });
    });

    // Share
    document.getElementById("share-btn").addEventListener("click", doShare);

    // Settings toggles
    const hardToggle = document.getElementById("hard-toggle");
    hardToggle.checked = hardMode;
    hardToggle.addEventListener("change", function () {
      // Can't switch to hard mode mid-game once guesses are in.
      if (hardToggle.checked && state.guesses.length > 0 && !state.done) {
        hardToggle.checked = false;
        toast("Hard mode can only be enabled at the start");
        return;
      }
      hardMode = hardToggle.checked;
      try { localStorage.setItem(LS.hard, hardMode ? "1" : "0"); } catch (e) {}
    });

    document.getElementById("dark-toggle").addEventListener("change", function (e) {
      applyTheme(e.target.checked ? "dark" : "light");
    });

    document.getElementById("new-game-btn").addEventListener("click", startRandomGame);
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  function init() {
    initTheme();
    stats = loadStats();
    try { hardMode = localStorage.getItem(LS.hard) === "1"; } catch (e) {}

    // Load or create today's game.
    const saved = loadState();
    const day = todayEpochDay();
    if (saved && (saved.mode === "random" || saved.dayNumber === day)) {
      state = saved;
    } else {
      state = newDailyState();
      saveState();
    }

    buildBoard();
    buildKeyboard();
    buildExamples();
    renderCompletedRows();
    paintKeyboard();
    wire();

    // First-time visitors see the help screen.
    let seen;
    try { seen = localStorage.getItem(LS.seenHelp); } catch (e) {}
    if (!seen) {
      openOverlay("help-overlay");
      try { localStorage.setItem(LS.seenHelp, "1"); } catch (e) {}
    } else if (state.done) {
      // Returning to a finished daily puzzle -> show stats.
      setTimeout(openStats, 300);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
