/**
 * MIRAVA FORTUNE WHEEL — TELEGRAM MINI APP
 * Полностью независимое приложение Колеса фортуны.
 * Связывается напрямую с сервером Mirava API (https://mirava.dedyn.io:8080).
 */

(function () {
  'use strict';

  // ==============================================================
  // 1. КОНФИГУРАЦИЯ БЭКЕНДА
  // ==============================================================
  // Боевой адрес бэкенда Mirava VPN (CORS настроен)
  const DEFAULT_BACKEND_URL = 'https://mirava.dedyn.io:8080';

  // Определение базового адреса API бэкенда
  function resolveBackendApiUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const hashStr = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hashStr);

    const candidate = (
      urlParams.get('api') ||
      urlParams.get('api_url') ||
      urlParams.get('backend') ||
      hashParams.get('api') ||
      hashParams.get('api_url') ||
      (typeof window !== 'undefined' && (window.API_URL || window.__API_URL__)) ||
      ''
    ).trim();

    // Проверка на валидность: не относительный путь, не GitHub Pages
    if (!candidate || candidate.includes('github.io') || (!candidate.startsWith('http://') && !candidate.startsWith('https://'))) {
      if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        return 'http://localhost:8080';
      }
      return DEFAULT_BACKEND_URL;
    }

    return candidate.replace(/\/+$/, '');
  }

  const API_BASE = resolveBackendApiUrl();

  // ==============================================================
  // 2. ИНИЦИАЛИЗАЦИЯ TELEGRAM WEBAPP & ПОЛУЧЕНИЕ TELEGRAM_ID
  // ==============================================================
  const tg = window.Telegram?.WebApp;

  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('#0b0f19');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0b0f19');
      if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
    } catch (e) {
      console.warn('Telegram WebApp init warning:', e);
    }
  }

  // Извлечение данных пользователя (Telegram ID, username, name)
  function resolveTelegramUser() {
    let userId = null;
    let username = '';
    let firstName = '';

    // 1. Из WebApp.initDataUnsafe (нативный Telegram Mini App)
    if (tg?.initDataUnsafe?.user?.id) {
      userId = Number(tg.initDataUnsafe.user.id);
      username = tg.initDataUnsafe.user.username || '';
      firstName = tg.initDataUnsafe.user.first_name || '';
    }

    // 2. Из WebApp.initData (парсинг сырой query string)
    if (!userId && tg?.initData) {
      try {
        const parsed = new URLSearchParams(tg.initData);
        const userJson = parsed.get('user');
        if (userJson) {
          const userObj = JSON.parse(userJson);
          if (userObj?.id) {
            userId = Number(userObj.id);
            username = username || userObj.username || '';
            firstName = firstName || userObj.first_name || '';
          }
        }
      } catch (e) {
        console.warn('InitData user parse error:', e);
      }
    }

    // 3. Из URL hash (#tgWebAppData=... или прямые параметры)
    if (!userId && window.location.hash) {
      try {
        const hashStr = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
        const hashParams = new URLSearchParams(hashStr);
        const tgData = hashParams.get('tgWebAppData');
        if (tgData) {
          const innerParams = new URLSearchParams(tgData);
          const userRaw = innerParams.get('user');
          if (userRaw) {
            const u = JSON.parse(userRaw);
            if (u?.id) {
              userId = Number(u.id);
              username = username || u.username || '';
              firstName = firstName || u.first_name || '';
            }
          }
        }
        if (!userId) {
          const directUid = hashParams.get('uid') || hashParams.get('telegram_id') || hashParams.get('user_id') || hashParams.get('id');
          if (directUid) userId = Number(directUid);
        }
      } catch (e) {
        console.warn('Hash user parse error:', e);
      }
    }

    // 4. Из обычных параметров URL (?uid=12345 / ?telegram_id=12345)
    if (!userId) {
      const urlParams = new URLSearchParams(window.location.search);
      const qId = urlParams.get('uid') || urlParams.get('telegram_id') || urlParams.get('user_id') || urlParams.get('id');
      if (qId && !isNaN(Number(qId))) {
        userId = Number(qId);
      }
      username = username || urlParams.get('username') || '';
      firstName = firstName || urlParams.get('first_name') || '';
    }

    // 5. Из кэша localStorage
    if (!userId) {
      try {
        const cached = localStorage.getItem('mirava_wheel_uid');
        if (cached && !isNaN(Number(cached))) {
          userId = Number(cached);
        }
      } catch (e) {}
    } else {
      try {
        localStorage.setItem('mirava_wheel_uid', String(userId));
      } catch (e) {}
    }

    return {
      id: userId || 0,
      username: username,
      firstName: firstName
    };
  }

  const currentUser = resolveTelegramUser();
  const currentUserId = currentUser.id;

  // Извлечение начального количества спинов из URL
  const initialUrlParams = new URLSearchParams(window.location.search);
  let spinsLeft = Number(initialUrlParams.get('spins') || 0);
  if (isNaN(spinsLeft) || spinsLeft < 0) spinsLeft = 0;

  // ==============================================================
  // 3. СЕКТОРЫ КОЛЕСА ФОРТУНЫ
  // ==============================================================
  // 7 секторов соответствуют настройке бэкенда Mirava
  const WHEEL_SECTORS = [
    { id: 0, days: 1,  label: '+1 день',    color: '#2563eb', text_color: '#ffffff', icon: '🎁', desc: 'Стартовый приз' },
    { id: 1, days: 2,  label: '+2 дня',     color: '#7c3aed', text_color: '#ffffff', icon: '⚡', desc: 'Энергия' },
    { id: 2, days: 3,  label: '+3 дня',     color: '#db2777', text_color: '#ffffff', icon: '🔥', desc: 'Ускорение' },
    { id: 3, days: 5,  label: '+5 дней',    color: '#059669', text_color: '#ffffff', icon: '💎', desc: 'Премиум' },
    { id: 4, days: 7,  label: '+7 дней',    color: '#0284c7', text_color: '#ffffff', icon: '🚀', desc: 'Турбо' },
    { id: 5, days: 7,  label: '+7 дней VIP', color: '#d97706', text_color: '#ffffff', icon: '👑', desc: 'VIP статус' },
    { id: 6, days: 10, label: '+10 дней',   color: '#e11d48', text_color: '#ffffff', icon: '🌟', desc: 'Супер-приз' }
  ];

  let currentRotation = 0;
  let isSpinning = false;
  let cachedSubExpiry = '';

  // ==============================================================
  // 3.5. АУДИОМЕНЕДЖЕР КОЛЕСА ФОРТУНЫ (HTML5 Audio)
  // ==============================================================
  const SOUND_CONFIG = {
    start: 'sounds/spin_start.wav',
    tick: 'sounds/spin_tick.wav',
    win: 'sounds/win.wav'
  };

  // Состояние звука (с сохранением в localStorage)
  let isMuted = false;
  try {
    isMuted = localStorage.getItem('mirava_wheel_muted') === 'true';
  } catch (e) {
    isMuted = false;
  }

  // Создание Audio объектов со стандартными параметрами
  function createAudio(src, volume = 0.8) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume;
    audio.src = src;
    return audio;
  }

  const startAudio = createAudio(SOUND_CONFIG.start, 0.75);
  const winAudio = createAudio(SOUND_CONFIG.win, 0.85);

  // Пул Audio-объектов для тиков (быстрые тики не обрывают друг друга)
  const TICK_POOL_SIZE = 6;
  const tickAudioPool = [];
  for (let i = 0; i < TICK_POOL_SIZE; i++) {
    tickAudioPool.push(createAudio(SOUND_CONFIG.tick, 0.55));
  }
  let currentTickIdx = 0;

  // Флаг мягкой инициализации браузерного автоплея
  let audioUnlocked = false;

  // Мягкая инициализация аудио по первому клику/касанию пользователя
  function softInitAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    const allAudios = [startAudio, winAudio, ...tickAudioPool];
    allAudios.forEach(a => {
      try {
        a.load();
        const p = a.play();
        if (p !== undefined) {
          p.then(() => {
            a.pause();
            a.currentTime = 0;
          }).catch(() => {});
        }
      } catch (e) {}
    });

    ['click', 'touchstart', 'pointerdown'].forEach(evt => {
      document.removeEventListener(evt, softInitAudio, true);
    });
  }

  // Навешиваем слушатели на первый пользовательский жест на документе
  ['click', 'touchstart', 'pointerdown'].forEach(evt => {
    document.addEventListener(evt, softInitAudio, { capture: true, once: true });
  });

  // Безопасное воспроизведение с защитой от ошибок блокировки автоплея
  function safePlayAudio(audio, volume) {
    if (isMuted || !audio) return;
    try {
      if (typeof volume === 'number') {
        audio.volume = Math.max(0, Math.min(1, volume));
      }
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          // Мягкий перехват блокировки автоплея браузером
          console.warn('Audio playback prevented by browser policy:', err?.name || err);
        });
      }
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Воспроизведение звука старта вращения (при клике на кнопку запуска)
  function playStartSound() {
    softInitAudio();
    safePlayAudio(startAudio, 0.75);
  }

  // Воспроизведение звука тика во время вращения колеса
  function playTickSound() {
    if (isMuted) return;
    softInitAudio();
    try {
      const audio = tickAudioPool[currentTickIdx];
      currentTickIdx = (currentTickIdx + 1) % TICK_POOL_SIZE;
      safePlayAudio(audio, 0.55);
    } catch (e) {}
  }

  // Воспроизведение звука победы (когда колесо остановилось на выигрышном секторе)
  function playWinSound() {
    softInitAudio();
    safePlayAudio(winAudio, 0.85);
  }

  // Остановка звука победы при закрытии окна
  function stopWinAudio() {
    try {
      if (winAudio) {
        winAudio.pause();
        winAudio.currentTime = 0;
      }
    } catch (e) {}
  }

  // Полная остановка всех звуковых эффектов
  function stopAllAudio() {
    try {
      if (startAudio) {
        startAudio.pause();
        startAudio.currentTime = 0;
      }
      if (winAudio) {
        winAudio.pause();
        winAudio.currentTime = 0;
      }
      tickAudioPool.forEach(a => {
        try {
          a.pause();
          a.currentTime = 0;
        } catch (e) {}
      });
    } catch (e) {}
  }

  // Переключение состояния звука (кнопка 🔊/🔇)
  function toggleMute() {
    softInitAudio();
    isMuted = !isMuted;
    try {
      localStorage.setItem('mirava_wheel_muted', isMuted ? 'true' : 'false');
    } catch (e) {}

    updateSoundButtonUI();

    if (isMuted) {
      stopAllAudio();
      showToast('Звук выключен 🔇', '🔇');
    } else {
      showToast('Звук включен 🔊', '🔊');
      playTickSound();
    }

    if (tg?.HapticFeedback) {
      try {
        tg.HapticFeedback.selectionChanged();
      } catch (e) {}
    }
  }

  // Обновление иконки и атрибутов кнопки переключения звука
  function updateSoundButtonUI() {
    const btn = document.getElementById('sound-toggle-btn');
    const icon = document.getElementById('sound-toggle-icon');
    if (!btn) return;

    if (isMuted) {
      btn.classList.add('is-muted');
      btn.title = 'Звук: Выключен (нажмите, чтобы включить)';
      btn.setAttribute('aria-label', 'Включить звук');
      if (icon) icon.innerText = '🔇';
    } else {
      btn.classList.remove('is-muted');
      btn.title = 'Звук: Включен (нажмите, чтобы отключить)';
      btn.setAttribute('aria-label', 'Отключить звук');
      if (icon) icon.innerText = '🔊';
    }
  }

  // ==============================================================
  // 4. ОТРИСОВКА КОЛЕСА НА CANVAS (High-DPI Retina)
  // ==============================================================
  function drawWheelCanvas() {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const displaySize = 280;

    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    ctx.scale(dpr, dpr);

    const cx = displaySize / 2;
    const cy = displaySize / 2;
    const radius = displaySize / 2 - 10;
    const numSectors = WHEEL_SECTORS.length;
    const arc = (2 * Math.PI) / numSectors;

    ctx.clearRect(0, 0, displaySize, displaySize);

    // Внешний тёмный обод
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#fbbf24';
    ctx.stroke();

    // Отрисовка каждого из 7 секторов
    for (let i = 0; i < numSectors; i++) {
      const sector = WHEEL_SECTORS[i];
      const startAngle = i * arc;
      const endAngle = (i + 1) * arc;

      // Тело сектора
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = sector.color;
      ctx.fill();

      // Радиальный блеск
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
      grad.addColorStop(0.65, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Разделитель
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.stroke();

      // Иконка и текст
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(startAngle + arc / 2);
      ctx.translate(radius * 0.64, 0);
      ctx.rotate(Math.PI / 2);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (sector.icon) {
        ctx.font = '20px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(sector.icon, 0, -11);
      }

      ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = sector.text_color || '#ffffff';
      ctx.fillText(sector.label, 0, 12);
      ctx.restore();
    }

    // Золотые заклёпки / LED огоньки (28 штук)
    const totalRivets = 28;
    for (let r = 0; r < totalRivets; r++) {
      const rivetAngle = (r * 2 * Math.PI) / totalRivets;
      const rx = cx + (radius + 4.5) * Math.cos(rivetAngle);
      const ry = cy + (radius + 4.5) * Math.sin(rivetAngle);
      ctx.beginPath();
      ctx.arc(rx, ry, 2.8, 0, 2 * Math.PI);
      ctx.fillStyle = r % 2 === 0 ? '#fbbf24' : '#ffffff';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 3;
      ctx.fill();
    }
  }

  // ==============================================================
  // 5. ОБНОВЛЕНИЕ ИНТЕРФЕЙСА
  // ==============================================================
  function updateUI() {
    // Счетчик спинов
    const countEl = document.getElementById('wheel-spins-count');
    if (countEl) countEl.innerText = spinsLeft;

    // Пользователь
    const nameEl = document.getElementById('user-name-text');
    const avatarEl = document.getElementById('user-avatar-badge');
    if (nameEl) {
      if (currentUser.firstName || currentUser.username) {
        nameEl.innerText = currentUser.firstName || `@${currentUser.username}`;
      } else if (currentUserId) {
        nameEl.innerText = `ID: ${currentUserId}`;
      } else {
        nameEl.innerText = 'Гость';
      }
    }
    if (avatarEl && (currentUser.firstName || currentUser.username)) {
      const letter = (currentUser.firstName || currentUser.username).charAt(0).toUpperCase();
      avatarEl.innerText = letter || '👤';
    }

    // Подписка
    const subEl = document.getElementById('user-sub-status');
    if (subEl) {
      if (cachedSubExpiry) {
        subEl.innerHTML = `до <b>${cachedSubExpiry}</b>`;
      } else {
        subEl.innerText = 'Проверка...';
      }
    }

    // Кнопка прокрутки
    const btn = document.getElementById('btn-spin-action');
    const btnText = document.getElementById('btn-spin-text');
    const btnIcon = document.getElementById('btn-spin-icon');

    if (!btn || isSpinning) return;

    if (spinsLeft > 0) {
      let word = 'вращений';
      if (spinsLeft % 10 === 1 && spinsLeft % 100 !== 11) word = 'вращение';
      else if ([2, 3, 4].includes(spinsLeft % 10) && ![12, 13, 14].includes(spinsLeft % 100)) word = 'вращения';

      btn.classList.add('pulse-btn');
      btn.classList.remove('btn-no-spins');
      btn.disabled = false;
      if (btnIcon) btnIcon.innerText = '🎰';
      if (btnText) btnText.innerText = `Испытать удачу (${spinsLeft} ${word})`;
    } else {
      btn.classList.remove('pulse-btn');
      btn.classList.add('btn-no-spins');
      btn.disabled = false;
      if (btnIcon) btnIcon.innerText = '🎟';
      if (btnText) btnText.innerText = 'Получить вращения (0 шт.)';
    }

    // Показываем предупреждение предпросмотра, если telegram_id не передан
    const demoBanner = document.getElementById('demo-banner');
    if (demoBanner) {
      demoBanner.style.display = currentUserId === 0 ? 'block' : 'none';
    }
  }

  // ==============================================================
  // 6. СИНХРОНИЗАЦИЯ С БЭКЕНДОМ (/api/wheel/status)
  // ==============================================================
  async function syncWheelStatus() {
    if (!currentUserId) return;
    try {
      const url = `${API_BASE}/api/wheel/status?telegram_id=${encodeURIComponent(currentUserId)}`;
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.success) {
          if (typeof data.spins_left === 'number') {
            spinsLeft = data.spins_left;
          }
          if (data.expires_at_formatted) {
            cachedSubExpiry = data.expires_at_formatted;
          } else if (data.is_active === 0) {
            cachedSubExpiry = 'Не активна';
          }
          updateUI();
        }
      }
    } catch (e) {
      console.warn('Sync wheel status error:', e);
    }
  }

  // ==============================================================
  // 7. ВРАЩЕНИЕ КОЛЕСА (/api/wheel/spin)
  // ==============================================================
  async function handleSpinClick() {
    if (isSpinning) return;

    // Если попыток нет — показываем модальное окно правил
    if (spinsLeft <= 0) {
      openInfoModal();
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
      return;
    }

    // Если telegram_id не определен (открыто вне бота)
    if (!currentUserId) {
      showToast('⚠️ Откройте Колесо через Telegram-бота @MiravaVPN_bot', '🤖');
      return;
    }

    isSpinning = true;
    playStartSound(); // Звук старта вращения (при нажатии на кнопку)

    const btn = document.getElementById('btn-spin-action');
    const btnText = document.getElementById('btn-spin-text');
    const btnIcon = document.getElementById('btn-spin-icon');
    if (btn) {
      btn.disabled = true;
      btn.classList.remove('pulse-btn');
    }
    if (btnIcon) btnIcon.innerText = '⏳';
    if (btnText) btnText.innerText = 'Вращаем колесо фортуны...';

    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');

    // Отправка запроса на бэкенд
    let apiResult = null;
    try {
      const spinUrl = `${API_BASE}/api/wheel/spin`;
      let resp = null;

      // Попытка 1: POST
      try {
        resp = await fetch(spinUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ telegram_id: currentUserId, uid: currentUserId })
        });
      } catch (postErr) {
        console.warn('POST failed, fallback to GET:', postErr);
      }

      // Попытка 2: GET fallback
      if (!resp || !resp.ok) {
        resp = await fetch(`${spinUrl}?telegram_id=${encodeURIComponent(currentUserId)}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
      }

      if (resp && resp.ok) {
        apiResult = await resp.json();
      }
    } catch (err) {
      console.error('Spin API request error:', err);
    }

    // Если бэкенд вернул ошибку
    if (!apiResult || !apiResult.success) {
      stopAllAudio();
      isSpinning = false;
      updateUI();
      if (apiResult && apiResult.error === 'no_spins') {
        spinsLeft = 0;
        updateUI();
        showToast('У вас закончились вращения', '🎟');
      } else {
        showToast('⚠️ Ошибка связи с сервером. Попробуйте снова!', '❌');
      }
      return;
    }

    // Бэкенд подтвердил выигрыш
    const wonDays = apiResult.won_days || 1;
    const targetSectorIndex = typeof apiResult.sector_index === 'number'
      ? apiResult.sector_index
      : WHEEL_SECTORS.findIndex(s => s.days === wonDays);

    const safeSectorIndex = (targetSectorIndex >= 0 && targetSectorIndex < WHEEL_SECTORS.length)
      ? targetSectorIndex
      : 0;

    const prize = apiResult.prize || WHEEL_SECTORS[safeSectorIndex];

    // Точный расчёт угла: указатель находится вверху (12 часов, 270° на Canvas)
    const numSectors = WHEEL_SECTORS.length;
    const sectorArcDeg = 360 / numSectors;
    const sectorCenterDeg = (safeSectorIndex + 0.5) * sectorArcDeg;
    const targetDelta = ((270 - sectorCenterDeg) % 360 + 360) % 360;

    const fullSpins = 6; // 6 полных оборотов
    const currentMod = ((currentRotation % 360) + 360) % 360;
    let addDegrees = targetDelta - currentMod;
    if (addDegrees < 0) addDegrees += 360;

    // Небольшое реалистичное смещение внутри сектора (+-7°)
    const jitter = (Math.random() - 0.5) * (sectorArcDeg * 0.28);
    const finalRotation = currentRotation + (fullSpins * 360) + addDegrees + jitter;

    const rotator = document.getElementById('wheel-rotator');
    const pointer = document.getElementById('wheel-pointer');

    // Анимация тиков и воспроизведение звука тиков во время вращения колеса
    let isTicking = true;
    let elapsed = 0;
    let tickTimeout = null;
    let tickCount = 0;
    const spinDuration = 4500;

    function onWheelTick() {
      if (!isTicking) return;
      tickCount++;

      // Звук тика вращения колеса
      playTickSound();

      // Анимация флажка/указателя
      if (pointer) {
        pointer.classList.add('tick');
        setTimeout(() => {
          if (pointer) pointer.classList.remove('tick');
        }, 45);
      }

      // Тактильный отклик в Telegram
      if (tg?.HapticFeedback && tickCount % 2 === 0) {
        try {
          tg.HapticFeedback.impactOccurred('light');
        } catch (e) {}
      }

      // Плавное реалистичное замедление тиков с замедлением вращения колеса
      const progress = Math.min(1.0, elapsed / spinDuration);
      const delay = 75 + Math.pow(progress, 2.7) * 440;
      elapsed += delay;

      if (elapsed < spinDuration - 100) {
        tickTimeout = setTimeout(onWheelTick, delay);
      } else {
        isTicking = false;
      }
    }

    onWheelTick();

    rotator.style.transition = 'transform 4.5s cubic-bezier(0.12, 0.95, 0.2, 1)';
    rotator.style.transform = `rotate(${finalRotation}deg)`;
    currentRotation = finalRotation;

    // Ожидание завершения вращения
    setTimeout(() => {
      isTicking = false;
      if (tickTimeout) clearTimeout(tickTimeout);
      if (pointer) pointer.classList.remove('tick');

      spinsLeft = typeof apiResult.spins_left === 'number' ? apiResult.spins_left : Math.max(0, spinsLeft - 1);
      if (apiResult.expires_at_formatted) {
        cachedSubExpiry = apiResult.expires_at_formatted;
      }
      isSpinning = false;
      updateUI();

      if (tg?.HapticFeedback) {
        try {
          tg.HapticFeedback.notificationOccurred('success');
        } catch (e) {}
      }

      // Звук остановки и победы
      playWinSound();

      launchConfetti();
      showWinCelebration(prize, wonDays, apiResult);
    }, 4650);
  }

  // ==============================================================
  // 8. ПРАЗДНИЧНОЕ КОНФЕТТИ
  // ==============================================================
  let confettiId = null;
  function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';

    const colors = ['#f59e0b', '#ec4899', '#3b82f6', '#10b981', '#8b5cf6', '#38bdf8', '#ffffff'];
    const particles = [];
    const count = 120;

    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 80,
        y: canvas.height * 0.45 + (Math.random() - 0.5) * 60,
        w: Math.random() * 8 + 5,
        h: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 15,
        vy: -Math.random() * 12 - 5,
        gravity: 0.28,
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 14,
        opacity: 1
      });
    }

    if (confettiId) cancelAnimationFrame(confettiId);
    const startTime = Date.now();

    function renderConfetti() {
      const elapsed = Date.now() - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.vRot;

        if (elapsed > 2000) p.opacity -= 0.02;

        if (p.opacity > 0 && p.y < canvas.height + 50) {
          alive++;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }

      if (alive > 0 && elapsed < 4200) {
        confettiId = requestAnimationFrame(renderConfetti);
      } else {
        canvas.style.display = 'none';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        confettiId = null;
      }
    }

    confettiId = requestAnimationFrame(renderConfetti);
  }

  // ==============================================================
  // 9. МОДАЛЬНЫЕ ОКНА & УВЕДОМЛЕНИЯ
  // ==============================================================
  function showWinCelebration(prize, wonDays, res) {
    const modal = document.getElementById('win-modal-overlay');
    const descEl = document.getElementById('win-modal-desc');
    const prizeEl = document.getElementById('win-prize-badge');
    const iconEl = document.getElementById('win-modal-icon');
    if (!modal || !descEl) return;

    if (iconEl) iconEl.innerText = prize?.icon || '🎉';

    let dayWord = 'дней';
    if (wonDays === 1) dayWord = 'день';
    else if ([2, 3, 4].includes(wonDays)) dayWord = 'дня';

    if (prizeEl) {
      prizeEl.innerText = `${prize?.icon || '🎁'} +${wonDays} ${dayWord}`;
    }

    const expiryText = res.expires_at_formatted || cachedSubExpiry || 'успешно обновлён';

    descEl.innerHTML = `
      <div style="font-size: 14.5px; font-weight: 700; color: #f1f5f9; margin-bottom: 12px;">
        Бонусные дни уже добавлены к вашей подписке Mirava VPN!
      </div>
      <div style="background: rgba(255, 255, 255, 0.06); padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.12); text-align: left; font-size: 13px; line-height: 1.6;">
        📅 Срок подписки: <b style="color: #4ade80;">до ${expiryText}</b><br>
        🎟 Осталось вращений: <b style="color: #fbbf24;">${res.spins_left ?? spinsLeft}</b>
      </div>
    `;

    modal.classList.add('active');
  }

  function closeWinModal() {
    stopWinAudio();
    const modal = document.getElementById('win-modal-overlay');
    if (modal) modal.classList.remove('active');
  }

  function openInfoModal() {
    const modal = document.getElementById('info-modal-overlay');
    if (modal) modal.classList.add('active');
  }

  function closeInfoModal() {
    const modal = document.getElementById('info-modal-overlay');
    if (modal) modal.classList.remove('active');
  }

  function showToast(text, icon = 'ℹ️') {
    const toast = document.getElementById('toast-container');
    const textEl = document.getElementById('toast-text');
    const iconEl = document.getElementById('toast-icon');
    if (!toast) return;

    if (iconEl) iconEl.innerText = icon;
    if (textEl) textEl.innerText = text;

    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  // ==============================================================
  // 10. ИНИЦИАЛИЗАЦИЯ И СЛУШАТЕЛИ
  // ==============================================================
  document.addEventListener('DOMContentLoaded', () => {
    // Canvas
    drawWheelCanvas();

    // Кнопка включения / выключения звука
    const soundToggleBtn = document.getElementById('sound-toggle-btn');
    if (soundToggleBtn) soundToggleBtn.addEventListener('click', toggleMute);
    updateSoundButtonUI();

    // Слушатели вращения
    const spinBtn = document.getElementById('btn-spin-action');
    const centerCap = document.getElementById('wheel-center-cap');
    if (spinBtn) spinBtn.addEventListener('click', handleSpinClick);
    if (centerCap) centerCap.addEventListener('click', handleSpinClick);

    // Закрытие модалок
    const closeWinBtn = document.getElementById('win-modal-close-btn');
    if (closeWinBtn) closeWinBtn.addEventListener('click', closeWinModal);

    const closeInfoBtn = document.getElementById('info-modal-close-btn');
    if (closeInfoBtn) closeInfoBtn.addEventListener('click', closeInfoModal);

    const infoPills = document.querySelectorAll('.trigger-info-modal');
    infoPills.forEach(el => el.addEventListener('click', openInfoModal));

    // Ресайз
    window.addEventListener('resize', drawWheelCanvas);

    // Первичный UI и синхронизация статуса
    updateUI();
    syncWheelStatus();
  });

})();
