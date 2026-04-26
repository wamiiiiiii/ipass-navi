/**
 * celebration.js
 * 正解時の演出（紙吹雪・効果音・ハプティクス・バウンス）
 *
 * 【設計方針】
 * - 外部ライブラリは使わない（紙吹雪はDOM＋CSS、効果音はWebAudio APIで合成）
 * - 1回の正解で1回だけ呼ぶ：内部状態を持たないステートレス関数として実装
 * - 効果音は設定（settings.sound_enabled）が true のときのみ鳴らす（デフォルトOFF）
 * - すべての演出は失敗しても本来の正解処理を妨げない（try/catchで握る）
 */

import { getSettings } from '../store.js';

// 紙吹雪の色パレット（ブランドカラーと暖色を中心に）
const CONFETTI_COLORS = [
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#10B981', // emerald-500
  '#6366F1', // indigo-500（ブランドカラー）
  '#EC4899', // pink-500
  '#84CC16', // lime-500
  '#F97316', // orange-500
];

// 紙吹雪の片数（多すぎるとモバイルで重くなる）
const CONFETTI_COUNT = 60;

// 紙吹雪の表示時間（ms）。CSSアニメと一致させること
const CONFETTI_DURATION_MS = 2200;

// バウンスアニメの持続時間（ms）。CSSの.celebration-bounceと一致させる
const BOUNCE_DURATION_MS = 600;

// WebAudio コンテキストはブラウザのユーザー操作後にのみ生成可能。再利用するためモジュール変数で保持
let _audioCtx = null;

/**
 * AudioContextを取得する（遅延初期化）
 * ユーザーのタップ後に呼ばれる前提
 * @returns {AudioContext|null} 失敗時は null
 */
function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = new Ctx();
    return _audioCtx;
  } catch (error) {
    console.warn('[Celebration] AudioContextの初期化に失敗しました', error);
    return null;
  }
}

/**
 * 正解時の chime（C5→E5→G5の3音アルペジオ）を鳴らす
 * 素材ファイル不要・WebAudio APIで波形を合成する
 */
function playSuccessChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;

  try {
    // ブラウザのオートプレイ制限でサスペンドされている場合は再開する
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // 3音をずらして鳴らす（アルペジオ）
    const notes = [
      { freq: 523.25, delay: 0    }, // C5
      { freq: 659.25, delay: 0.08 }, // E5
      { freq: 783.99, delay: 0.16 }, // G5
    ];

    const now = ctx.currentTime;

    notes.forEach(({ freq, delay }) => {
      // sine波で柔らかい音にする（鋭い音は学習中に不快）
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      // ゲインで音量包絡（attack→decay）を作る
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.02); // 急速に立ち上げ
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.4); // ゆっくり減衰

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + delay);
      osc.stop(now + delay + 0.5);
    });
  } catch (error) {
    console.warn('[Celebration] 効果音の再生に失敗しました', error);
  }
}

/**
 * モバイルでハプティック（軽い振動）を発生させる
 * 対応していないデバイス・ブラウザでは何もしない
 */
function triggerHaptic() {
  try {
    if (typeof navigator.vibrate === 'function') {
      // 30ms の短いパルス（不快にならない長さ）
      navigator.vibrate(30);
    }
  } catch (error) {
    // vibrate は権限エラーで例外を投げることがあるが、演出失敗は致命的でないので握る
  }
}

/**
 * 紙吹雪のDOMをbody直下に生成して、CSSアニメで落下させる
 * アニメ完了後に自動で要素を削除する
 */
function launchConfetti() {
  try {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    // pointer-events:none と aria-hidden で操作・読み上げを妨げない
    container.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';

      // 開始位置（横方向は画面全体に分散）
      const startLeft = Math.random() * 100; // 0〜100%
      // 落下のばらつきを CSS 変数で渡す（CSSアニメ側で参照）
      const drift = (Math.random() - 0.5) * 200; // -100px〜+100px の横ドリフト
      const rotateDeg = Math.floor(Math.random() * 720) - 360; // 回転量
      const delay = Math.random() * 0.4; // 開始遅延 0〜0.4s でばらつき
      const duration = 1.6 + Math.random() * 0.6; // 1.6〜2.2秒の落下時間
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      const size = 6 + Math.random() * 6; // 6〜12px

      piece.style.left = `${startLeft}%`;
      piece.style.background = color;
      piece.style.width = `${size}px`;
      piece.style.height = `${size * 0.4}px`; // 紙片らしい縦長比率
      piece.style.setProperty('--drift', `${drift}px`);
      piece.style.setProperty('--rotate', `${rotateDeg}deg`);
      piece.style.animationDelay = `${delay}s`;
      piece.style.animationDuration = `${duration}s`;

      container.appendChild(piece);
    }

    document.body.appendChild(container);

    // アニメ完了後にDOMから除去（メモリリーク防止）
    setTimeout(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    }, CONFETTI_DURATION_MS);
  } catch (error) {
    console.warn('[Celebration] 紙吹雪の生成に失敗しました', error);
  }
}

/**
 * 指定した要素にバウンスアニメを一時的に付与する
 * @param {HTMLElement} targetEl - bounceさせる要素（正解カードなど）
 */
function bounceElement(targetEl) {
  if (!targetEl || !targetEl.classList) return;
  try {
    targetEl.classList.add('celebration-bounce');
    // アニメ完了後にクラスを除去して、次回再生時に再付与できるようにする
    setTimeout(() => {
      targetEl.classList.remove('celebration-bounce');
    }, BOUNCE_DURATION_MS);
  } catch (error) {
    // 演出失敗は握る
  }
}

/**
 * 正解時の総合演出を発火する
 *
 * @param {HTMLElement} [targetEl] - bounceさせたい要素（省略可）。通常は正解カード
 *
 * 演出内訳：
 * - 紙吹雪（常時ON）
 * - 対象要素の bounce アニメ（targetEl 指定時のみ）
 * - ハプティクス（対応端末のみ・常時ON）
 * - 効果音（設定 sound_enabled=true のときのみ・デフォルトOFF）
 */
export function celebrateCorrect(targetEl) {
  // 紙吹雪は最優先で発火（視覚的にいちばん目立つ）
  launchConfetti();

  // 正解カードを bounce
  if (targetEl) {
    bounceElement(targetEl);
  }

  // ハプティクス（モバイルだけが反応する）
  triggerHaptic();

  // 効果音は設定で有効な場合のみ
  try {
    const settings = getSettings();
    if (settings.sound_enabled) {
      playSuccessChime();
    }
  } catch (error) {
    // 設定取得失敗時も演出失敗として握る
  }
}
