/**
 * Petzker Game SDK
 * Общий модуль для синхронизации очков игрока между мини-играми и основным приложением.
 * Подключается в каждую игру через <script src="petzker-sdk.js"></script>
 */

(function(global) {
  'use strict';

  const SUPABASE_URL      = 'https://heubrattlnikielnfheg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhldWJyYXR0bG5pa2llbG5maGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NzYyMjcsImV4cCI6MjEwMDU1MjIyN30._lRs77YnsILFN_Ru4uR2wDWQFtAlazZh8UaaKa7fsnM';

  // ── SUPABASE CLIENT ───────────────────────────────────────────────────
  let _sb = null;
  function getSb() {
    if (_sb) return _sb;
    if (typeof supabase !== 'undefined') {
      try { _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); } catch(e) {}
    }
    return _sb;
  }

  // ── PLAYER IDENTITY ───────────────────────────────────────────────────
  function resolvePlayer() {
    const p = new URLSearchParams(location.search);
    const uid  = p.get('uid');
    const name = p.get('name');
    if (uid) return { id: uid, name: name || ('User ' + uid) };
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      const u  = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      if (u && u.id) {
        return {
          id: String(u.id),
          name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || ('User '+u.id)
        };
      }
    } catch(e) {}
    return null;
  }

  // ── SCORE REPORTING ───────────────────────────────────────────────────
  /**
   * Добавляет очки игрока в общий рейтинг.
   * @param {string} gameId  - 'dice' | 'minesweeper' | 'doodle' | 'throne'
   * @param {number} points  - количество очков за эту сессию
   * @param {object} [meta]  - доп. данные (wave, time, zone…)
   */
  async function reportScore(gameId, points, meta) {
    const player = resolvePlayer();
    if (!points || points <= 0) return;

    // Уведомляем родительское окно (если игра в iframe)
    try {
      window.parent.postMessage({
        type: 'petzker-score',
        gameId,
        points,
        playerId:   player ? player.id   : null,
        playerName: player ? player.name : 'Гость',
        meta: meta || {}
      }, '*');
    } catch(e) {}

    // Сохраняем в Supabase напрямую
    const sb = getSb();
    if (!sb || !player) return;

    try {
      // 1. Upsert в player_ratings (суммируем)
      const { data: existing } = await sb
        .from('player_ratings')
        .select('total_score, games_played')
        .eq('telegram_user_id', player.id)
        .maybeSingle();

      const newTotal  = (existing ? existing.total_score   : 0) + points;
      const newGames  = (existing ? existing.games_played  : 0) + 1;

      await sb.from('player_ratings').upsert({
        telegram_user_id: player.id,
        name:             player.name,
        total_score:      newTotal,
        games_played:     newGames,
        updated_at:       new Date().toISOString()
      }, { onConflict: 'telegram_user_id' });

      // 2. Вставляем запись истории
      await sb.from('game_sessions').insert([{
        telegram_user_id: player.id,
        name:             player.name,
        game_id:          gameId,
        score:            points,
        meta:             meta ? JSON.stringify(meta) : null,
        played_at:        new Date().toISOString()
      }]);
    } catch(e) {
      console.error('[PetzkerSDK] reportScore error:', e);
    }
  }

  /**
   * Получает текущий баланс очков игрока.
   */
  async function getBalance(playerId) {
    const sb = getSb();
    if (!sb || !playerId) return 0;
    try {
      const { data } = await sb
        .from('player_ratings')
        .select('total_score')
        .eq('telegram_user_id', playerId)
        .maybeSingle();
      return data ? (data.total_score || 0) : 0;
    } catch(e) { return 0; }
  }

  /**
   * Списывает очки со счёта игрока (для ставок).
   */
  async function deductBalance(playerId, amount) {
    const sb = getSb();
    if (!sb || !playerId || amount <= 0) return false;
    try {
      const { data } = await sb
        .from('player_ratings')
        .select('total_score')
        .eq('telegram_user_id', playerId)
        .maybeSingle();
      if (!data || data.total_score < amount) return false;

      await sb.from('player_ratings').update({
        total_score: data.total_score - amount,
        updated_at:  new Date().toISOString()
      }).eq('telegram_user_id', playerId);
      return true;
    } catch(e) { return false; }
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────
  global.PetzkerSDK = {
    resolvePlayer,
    reportScore,
    getBalance,
    deductBalance,
    getSb
  };

})(window);
