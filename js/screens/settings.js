/**
 * settings.js
 * 設定画面の描画ロジック
 * テーマ切り替え・文字サイズ・データリセットの操作UI
 */

import { getSettings, updateSettings, resetAllData } from '../store.js';
import { clearCache } from '../dataLoader.js';
import {
  createElement,
  renderInto,
  showToast,
  createFocusTrap,
} from '../utils/render.js';

/**
 * 設定画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
export function renderSettings(container) {
  const settings = getSettings();

  const screen = createElement('div', { classes: ['settings-screen'] });

  // PWAインストール案内バナー（displayModeがbrowserの場合に表示）
  if (!isRunningAsPwa()) {
    screen.appendChild(buildPwaInstallBanner());
  }

  // 表示設定セクション
  screen.appendChild(buildDisplaySection(settings, container));

  // 学習設定セクション（試験日など）
  screen.appendChild(buildStudySection(settings, container));

  // データ管理セクション
  screen.appendChild(buildDataSection(container));

  // アプリ情報セクション
  screen.appendChild(buildAboutSection());

  renderInto(container, [screen]);
}

/**
 * 表示設定セクションを構築する
 * @param {Object} settings - 現在の設定値
 * @param {HTMLElement} container - 親コンテナ（再描画のため参照）
 * @returns {HTMLElement} 設定セクション要素
 */
function buildDisplaySection(settings, container) {
  const section = createElement('div', { classes: ['settings-section'] });

  section.appendChild(createElement('div', {
    classes: ['settings-section-header'],
    text: '表示設定',
  }));

  const card = createElement('div', { classes: ['settings-card'] });

  // テーマ設定（縦積みバリアント：ヘッダー+セレクタの2段構成）
  const themeItem = createElement('div', { classes: ['settings-item', 'settings-item--stack'] });

  const themeHeader = createElement('div', { classes: ['settings-item-row'] });

  const themeIcon = createElement('div', { classes: ['settings-item-icon', 'icon-bg-blue'], text: '🌓' });
  themeHeader.appendChild(themeIcon);

  const themeText = createElement('div', { classes: ['settings-item-text'] });
  themeText.appendChild(createElement('div', { classes: ['settings-item-label'], text: 'テーマ' }));
  themeText.appendChild(createElement('div', {
    classes: ['settings-item-sublabel'],
    text: '画面の明るさを切り替えます',
  }));
  themeHeader.appendChild(themeText);

  themeItem.appendChild(themeHeader);
  themeItem.appendChild(buildThemeSelector(settings.theme, container));
  card.appendChild(themeItem);

  // 区切り線
  card.appendChild(createElement('div', { classes: ['divider'], attrs: { style: 'margin:0' } }));

  // 文字サイズ設定（縦積みバリアント）
  const fontItem = createElement('div', { classes: ['settings-item', 'settings-item--stack'] });

  const fontHeader = createElement('div', { classes: ['settings-item-row'] });

  fontHeader.appendChild(createElement('div', { classes: ['settings-item-icon', 'icon-bg-orange'], text: '📝' }));

  const fontText = createElement('div', { classes: ['settings-item-text'] });
  fontText.appendChild(createElement('div', { classes: ['settings-item-label'], text: '文字サイズ' }));
  fontText.appendChild(createElement('div', {
    classes: ['settings-item-sublabel'],
    text: '教科書・問題の文字の大きさを変更します',
  }));
  fontHeader.appendChild(fontText);

  fontItem.appendChild(fontHeader);
  fontItem.appendChild(buildFontSizeSelector(settings.font_size, container));
  card.appendChild(fontItem);

  section.appendChild(card);

  return section;
}

/**
 * 学習設定セクションを構築する（試験日など）
 * @param {Object} settings - 現在の設定値
 * @param {HTMLElement} container - 親コンテナ（再描画のため参照）
 * @returns {HTMLElement} 設定セクション要素
 */
function buildStudySection(settings, container) {
  const section = createElement('div', { classes: ['settings-section'] });

  section.appendChild(createElement('div', {
    classes: ['settings-section-header'],
    text: '学習設定',
  }));

  const card = createElement('div', { classes: ['settings-card'] });

  // 試験予定日の入力（縦積みバリアント）
  const examItem = createElement('div', { classes: ['settings-item', 'settings-item--stack'] });

  const examHeader = createElement('div', { classes: ['settings-item-row'] });
  examHeader.appendChild(createElement('div', { classes: ['settings-item-icon', 'icon-bg-blue'], text: '🎯' }));

  const examText = createElement('div', { classes: ['settings-item-text'] });
  examText.appendChild(createElement('div', { classes: ['settings-item-label'], text: '試験予定日' }));
  examText.appendChild(createElement('div', {
    classes: ['settings-item-sublabel'],
    text: 'ホームに残り日数と日次ノルマを表示します',
  }));
  examHeader.appendChild(examText);
  examItem.appendChild(examHeader);

  // 日付入力 + クリアボタン
  const inputRow = createElement('div', { attrs: { style: 'display:flex;gap:8px;width:100%;align-items:center' } });
  const dateInput = createElement('input', {
    attrs: {
      type: 'date',
      style: 'flex:1;padding:8px;border:1px solid var(--color-border);border-radius:8px;font-size:1rem',
      value: settings.exam_date || '',
    },
  });
  dateInput.addEventListener('change', (e) => {
    // 空文字なら null として保存して「未設定」扱いにする
    const v = e.target.value || null;
    updateSettings({ exam_date: v });
  });
  inputRow.appendChild(dateInput);

  const clearBtn = createElement('button', {
    classes: ['settings-clear-btn'],
    attrs: { style: 'padding:8px 12px;border:1px solid var(--color-border);background:transparent;border-radius:8px;cursor:pointer' },
    text: 'クリア',
  });
  clearBtn.addEventListener('click', () => {
    updateSettings({ exam_date: null });
    renderSettings(container);
  });
  inputRow.appendChild(clearBtn);

  examItem.appendChild(inputRow);
  card.appendChild(examItem);

  // 区切り線（試験日 と 効果音設定 の間）
  card.appendChild(createElement('div', { classes: ['divider'], attrs: { style: 'margin:0' } }));

  // 効果音トグル：正解時の chime 音 ON/OFF
  card.appendChild(buildSoundToggleItem(settings, container));

  section.appendChild(card);
  return section;
}

/**
 * 効果音ON/OFFトグル項目を構築する
 * 正解時の chime 音を有効化するかどうかをユーザーが選択する
 * @param {Object} settings - 現在の設定値
 * @param {HTMLElement} container - 親コンテナ（再描画用）
 * @returns {HTMLElement} 効果音設定項目
 */
function buildSoundToggleItem(settings, container) {
  const item = createElement('div', { classes: ['settings-item'] });

  // アイコン（スピーカー絵文字でラベルを補強）
  item.appendChild(createElement('div', { classes: ['settings-item-icon', 'icon-bg-orange'], text: '🔔' }));

  // テキスト部（ラベル＋説明）
  const text = createElement('div', { classes: ['settings-item-text'] });
  text.appendChild(createElement('div', { classes: ['settings-item-label'], text: '正解時の効果音' }));
  text.appendChild(createElement('div', {
    classes: ['settings-item-sublabel'],
    text: '正解したときに小さな効果音を鳴らします',
  }));
  item.appendChild(text);

  // チェックボックス（ネイティブ要素）
  // role/labelは settings-item 全体に付けず、input 自体のクリックで切り替えできるようにする
  const isOn = settings.sound_enabled === true;
  const toggle = createElement('input', {
    attrs: {
      type: 'checkbox',
      'aria-label': '正解時の効果音を有効化する',
      style: 'width:20px;height:20px;cursor:pointer',
    },
  });
  toggle.checked = isOn;

  toggle.addEventListener('change', (e) => {
    const next = e.target.checked;
    updateSettings({ sound_enabled: next });
    showToast(
      next ? '効果音をオンにしました' : '効果音をオフにしました',
      'success',
    );
  });

  item.appendChild(toggle);

  return item;
}

/**
 * テーマ選択UIを構築する
 * @param {string} currentTheme - 現在のテーマ値
 * @param {HTMLElement} container - 親コンテナ（再描画のため参照）
 * @returns {HTMLElement} テーマ選択要素
 */
function buildThemeSelector(currentTheme, container) {
  const selector = createElement('div', { classes: ['theme-selector'] });

  const themes = [
    { id: 'light',  label: 'ライト', previewClass: 'theme-preview-light' },
    { id: 'dark',   label: 'ダーク',  previewClass: 'theme-preview-dark' },
    { id: 'system', label: 'システム', previewClass: 'theme-preview-system' },
  ];

  themes.forEach((theme) => {
    const option = createElement('div', {
      classes: ['theme-option', currentTheme === theme.id ? 'is-selected' : ''],
    });

    option.appendChild(createElement('div', {
      classes: ['theme-preview', theme.previewClass],
    }));

    option.appendChild(createElement('span', {
      classes: ['theme-option-label'],
      text: theme.label,
    }));

    option.addEventListener('click', () => {
      // テーマを適用する
      applyTheme(theme.id);

      // 設定を保存
      updateSettings({ theme: theme.id });

      // 選択状態を更新
      selector.querySelectorAll('.theme-option').forEach((o) => o.classList.remove('is-selected'));
      option.classList.add('is-selected');

      showToast(`テーマを「${theme.label}」に変更しました`, 'success');
    });

    selector.appendChild(option);
  });

  return selector;
}

/**
 * 文字サイズ選択UIを構築する
 * @param {string} currentSize - 現在の文字サイズ値
 * @param {HTMLElement} container - 親コンテナ
 * @returns {HTMLElement} 文字サイズ選択要素
 */
function buildFontSizeSelector(currentSize, container) {
  const selector = createElement('div', { classes: ['font-size-selector'] });

  const sizes = [
    { id: 'small',  label: '小', previewClass: 'font-size-preview-small',  previewText: 'あ' },
    { id: 'medium', label: '中', previewClass: 'font-size-preview-medium', previewText: 'あ' },
    { id: 'large',  label: '大', previewClass: 'font-size-preview-large',  previewText: 'あ' },
  ];

  sizes.forEach((size) => {
    const option = createElement('div', {
      classes: ['font-size-option', currentSize === size.id ? 'is-selected' : ''],
    });

    option.appendChild(createElement('span', {
      classes: [size.previewClass],
      text: size.previewText,
    }));

    option.appendChild(createElement('span', {
      classes: ['font-size-option-label'],
      text: size.label,
    }));

    option.addEventListener('click', () => {
      // 文字サイズを適用する
      applyFontSize(size.id);

      // 設定を保存
      updateSettings({ font_size: size.id });

      // 選択状態を更新
      selector.querySelectorAll('.font-size-option').forEach((o) => o.classList.remove('is-selected'));
      option.classList.add('is-selected');

      showToast(`文字サイズを「${size.label}」に変更しました`, 'success');
    });

    selector.appendChild(option);
  });

  return selector;
}

/**
 * データ管理セクションを構築する
 * @param {HTMLElement} container - 親コンテナ（再描画のため参照）
 * @returns {HTMLElement} データ管理セクション要素
 */
function buildDataSection(container) {
  const section = createElement('div', { classes: ['settings-section'] });

  section.appendChild(createElement('div', {
    classes: ['settings-section-header'],
    text: 'データ管理',
  }));

  const card = createElement('div', { classes: ['settings-card'] });

  // データリセット項目
  const resetItem = createElement('div', { classes: ['settings-item'] });

  resetItem.appendChild(createElement('div', { classes: ['settings-item-icon', 'icon-bg-red'], text: '🗑️' }));

  const resetText = createElement('div', { classes: ['settings-item-text'] });
  resetText.appendChild(createElement('div', { classes: ['settings-item-label'], text: '学習データをリセット' }));
  resetText.appendChild(createElement('div', {
    classes: ['settings-item-sublabel'],
    text: '進捗・演習履歴・ブックマークをすべて削除します',
  }));
  resetItem.appendChild(resetText);

  resetItem.appendChild(createElement('span', { classes: ['settings-item-arrow'], text: '›' }));

  // クリックでリセット確認ダイアログを表示
  resetItem.addEventListener('click', () => {
    showResetConfirmDialog(container);
  });

  card.appendChild(resetItem);

  section.appendChild(card);

  return section;
}

/**
 * アプリ情報セクションを構築する
 * @returns {HTMLElement} アプリ情報セクション要素
 */
function buildAboutSection() {
  const section = createElement('div', { classes: ['settings-section'] });

  section.appendChild(createElement('div', {
    classes: ['settings-section-header'],
    text: 'アプリ情報',
  }));

  const card = createElement('div', { classes: ['settings-card'] });

  // バージョン表示
  // index.html の <meta name="app-version"> から動的に取得する。これによりリリースごとに
  // settings.js を編集しなくても表示が追従し、ユーザーがどの版を見ているかをひと目で判別できる。
  const versionItem = createElement('div', { classes: ['settings-item'] });
  versionItem.appendChild(createElement('div', { classes: ['settings-item-icon', 'icon-bg-gray'], text: 'ℹ️' }));

  const versionText = createElement('div', { classes: ['settings-item-text'] });
  versionText.appendChild(createElement('div', { classes: ['settings-item-label'], text: 'バージョン' }));
  versionText.appendChild(createElement('div', {
    classes: ['settings-item-sublabel'],
    text: 'シラバスVer.6.5対応',
  }));
  versionItem.appendChild(versionText);

  const versionMeta = document.querySelector('meta[name="app-version"]');
  const appVersion = versionMeta?.getAttribute('content') || '不明';
  versionItem.appendChild(createElement('span', {
    classes: ['settings-item-value'],
    text: `v${appVersion}`,
  }));

  card.appendChild(versionItem);
  section.appendChild(card);

  // 免責事項テキスト
  const disclaimer = createElement('div', { classes: ['settings-version'] });
  disclaimer.appendChild(createElement('div', {
    classes: ['settings-version-app'],
    text: 'iPass ナビ',
  }));
  disclaimer.appendChild(createElement('div', {
    text: 'ITパスポート試験（IPA）の出題範囲に基づいた学習アプリです。',
  }));
  disclaimer.appendChild(createElement('div', {
    attrs: { style: 'margin-top:4px' },
    text: '本コンテンツはAIを活用して制作しており、内容の正確性を保証するものではありません。',
  }));
  section.appendChild(disclaimer);

  return section;
}

/**
 * データリセット確認ダイアログを表示する
 * フォーカストラップ・Escキー閉じ・aria属性を追加してアクセシビリティを向上させる
 * @param {HTMLElement} container - 親コンテナ（ダイアログ表示後に画面を再描画するため）
 */
function showResetConfirmDialog(container) {
  // 既存のダイアログを削除
  const existing = document.getElementById('reset-dialog-overlay');
  if (existing) existing.remove();

  /**
   * ダイアログを閉じる処理（フォーカストラップのクリーンアップも行う）
   * フォーカストラップのクリーンアップ関数は後で代入するため変数として定義する
   */
  let cleanupFocusTrap = null;
  const closeDialog = () => {
    // フォーカストラップのイベントリスナーを解除する
    if (cleanupFocusTrap) cleanupFocusTrap();
    overlay.remove();
  };

  const overlay = createElement('div', {
    classes: ['reset-dialog-overlay'],
    attrs: { id: 'reset-dialog-overlay' },
  });

  // ダイアログ本体
  // role="alertdialog" で「操作が必要な警告ダイアログ」とスクリーンリーダーに伝える
  const dialog = createElement('div', {
    classes: ['reset-dialog'],
    attrs: {
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'reset-dialog-title',
      'aria-describedby': 'reset-dialog-body',
    },
  });

  dialog.appendChild(createElement('div', { classes: ['reset-dialog-icon'], text: '⚠️' }));

  dialog.appendChild(createElement('h2', {
    classes: ['reset-dialog-title'],
    attrs: { id: 'reset-dialog-title' },
    text: '学習データをリセットしますか？',
  }));

  dialog.appendChild(createElement('p', {
    classes: ['reset-dialog-body'],
    attrs: { id: 'reset-dialog-body' },
    text: '進捗・演習履歴・ブックマークがすべて削除されます。この操作は取り消せません。',
  }));

  const actions = createElement('div', { classes: ['reset-dialog-actions'] });

  // リセット実行ボタン
  const confirmBtn = createElement('button', {
    classes: ['reset-confirm-btn'],
    text: '🗑️ リセットする',
  });

  confirmBtn.addEventListener('click', () => {
    const success = resetAllData();

    if (success) {
      // データローダーのキャッシュもクリア
      clearCache();
      showToast('学習データをリセットしました', 'success');
    } else {
      showToast('リセットに失敗しました。再度お試しください', 'error');
    }

    // フォーカストラップを解除してからダイアログを閉じる
    closeDialog();

    // 設定画面を再描画
    renderSettings(container);
  });

  // キャンセルボタン
  const cancelBtn = createElement('button', {
    classes: ['reset-cancel-btn'],
    text: 'キャンセル',
    attrs: { 'aria-label': 'キャンセルしてダイアログを閉じる' },
  });

  cancelBtn.addEventListener('click', closeDialog);

  // オーバーレイクリックでキャンセル（ダイアログ外をクリックした場合のみ閉じる）
  overlay.addEventListener('click', (e) => {
    if (!dialog.contains(e.target)) {
      closeDialog();
    }
  });

  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // フォーカストラップを設定する（Escキー・Tab制御）
  // dialog をフォーカスの境界として指定し、Esc で closeDialog を呼ぶ
  cleanupFocusTrap = createFocusTrap(dialog, closeDialog);
}

/**
 * PWAインストール案内バナーを構築する
 * @returns {HTMLElement} インストール案内バナー要素
 */
function buildPwaInstallBanner() {
  const banner = createElement('div', { classes: ['pwa-install-banner'] });

  banner.appendChild(createElement('div', { classes: ['pwa-install-icon'], text: '📱' }));

  const text = createElement('div', { classes: ['pwa-install-text'] });
  text.appendChild(createElement('div', { classes: ['pwa-install-title'], text: 'ホーム画面に追加' }));
  text.appendChild(createElement('div', {
    classes: ['pwa-install-desc'],
    text: 'アプリとして使うとオフラインでも学習できます',
  }));
  banner.appendChild(text);

  const btn = createElement('button', {
    classes: ['pwa-install-btn'],
    text: '追加方法',
  });

  btn.addEventListener('click', () => {
    showToast('ブラウザのメニュー→「ホーム画面に追加」を選択してください', 'info', 4000);
  });

  banner.appendChild(btn);

  return banner;
}

/**
 * テーマを適用する
 * @param {string} theme - テーマ値（'light' | 'dark' | 'system'）
 */
export function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === 'system') {
    // システムのダーク/ライト設定に追従
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

/**
 * 文字サイズを適用する
 * @param {string} size - サイズ値（'small' | 'medium' | 'large'）
 */
export function applyFontSize(size) {
  document.documentElement.setAttribute('data-font-size', size);
}

/**
 * PWAとして動作しているかを確認する
 * @returns {boolean} PWAとして起動中の場合はtrue
 */
function isRunningAsPwa() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
