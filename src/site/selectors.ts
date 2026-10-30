/**
 * 画面のセレクタ・文言。サイトの DOM が変わったらここを直す。
 * 出典: 2026-10 時点の実画面 (ビジネス TOP) と Next.js client chunk の静的解析
 * (入力・確認画面は受付時間外で実画面を未確認のため、初回 dry-run で要確認)。
 */

/** ビジネス TOP /clinics/{owner}/businesses/{biz} */
export const TOP = {
  clinicName: "h1.ipk-page-title-main",
  businessName: "h2.ipk-page-title-sub",
  situationRoot: ".ipk-view-situation-j, .ipk-view-situation-w",
  situationOrder: ".ipk-view-situation-j",
  situationTimezone: ".ipk-view-situation-w",
  situationBody: ".ipk-view-situation-body",
  /** 診察時間外などの表示 (clinic_status) */
  nonService: "section.ipk-non-service",
  bookLink: "section.ipk-gmtp-to-book a",
} as const;

/** 予約開始 /bookings/new (順番予約・当日) */
export const NEW_BOOKING = {
  root: "section.ipk-date-select",
  /** search_vacancy_flg=1 の医院のみ存在 */
  todayRadio: "input#today",
  todayLabel: 'label[for="today"]',
  patientCountSelect: "section.ipk-select-book-num select",
  timeList: "section.ipk-time-list-j",
  /** 枠グループ (timezone_name ごと) */
  frameGroup: "section.ipk-time-list-j > div",
  frameName: "span.timezone",
  frameWait: "span.ipk-time-list-wait",
  frameOutOfPeriod: ".ipk-bookable-time.is-out-of-period",
  frameNextButton: "button.ipk-primary-btn",
  frameNextButtonHidden: "is-hidden",
  frameMessage: "p.ipk-time-list-message:not(.is-hidden)",
  /** 当日枠なし「現在、予約可能な時間ではありません。」 */
  noFrame: "section.ipk-non-time-frame:not(.is-hidden)",
} as const;

/** 入力 /bookings/new/{yyyymmdd}/frames/{id}/input */
export const INPUT = {
  form: "section.ipk-input-patient form",
  /** name 属性が `${n}_${fieldId}_${fieldNo}_${inputType}_${req}[_year|_month|_date]` の入力要素 */
  fields:
    "section.ipk-input-patient form input[name], section.ipk-input-patient form select[name], section.ipk-input-patient form textarea[name]",
  validationErrors: "div.ipk-input-patient-error:not(.is-hidden) p",
  cancelCode: 'input[name="cancelCode"]',
  consentCheckbox: "input#consent-checkbox",
  consentLabel: 'label[for="consent-checkbox"]',
  submit: "section.ipk-input-patient div.btn-area button.ipk-primary-btn",
  /** 同意未チェックで「次へ」を押すと出るモーダル */
  termsModal: "section.ipk-privacy-policy-modal",
  termsModalYes: "section.ipk-privacy-policy-modal button.ipk-primary-btn",
} as const;

/** 確認 /bookings/new_confirm */
export const CONFIRM = {
  guide: "section.ipk-guide",
  notYetText: /まだ完了していません/,
  patients: "section.ipk-confirm-patient",
  patientBlock: (n: number) => `div[id="ipk-input-patient-confirm-form-${n}"]`,
  item: ".ipk-confirm-patient-item",
  data: ".ipk-confirm-patient-data",
  /** 「予約する」({entry_disp_name}する) */
  submit: "div.btn-area button.ipk-primary-btn",
} as const;

/** 完了 /bookings/new_complete (DOM 未確認。テキストから受付番号を拾う) */
export const COMPLETE = {
  main: ".ipk-l-main-contents",
  /**
   * 受付番号のラベル (NFKC 正規化後のテキストに対して使う)。実画面の文言は未確認なので複数の候補を持つ。
   * 数字は 1〜6 桁で、日付・時刻・電話番号の一部 (後ろに年月日時分 / : - . 数字が続く) は除く。
   * 「診察券番号」「電話番号」「呼出番号」のように漢字・かなが前に付く「番号」は拾わない。
   */
  acceptNoLabels: [
    /(?:受付|予約|整理)\s*(?:番号|No\.?)/gi,
    /あなたの\s*(?:受付|予約|整理)?\s*(?:番号|順番)/g,
    /(?<![ぁ-んァ-ヶー一-龠々a-z0-9])番号/gi,
  ],
  /** ラベルの直後 (区切り・改行・括弧を挟んでよい) の数字。後ろに「番」が付いてもよい */
  acceptNoValue: /^[\s:：は、,【「『(（<>[]*?(\d{1,6})(?![\d年月日時分/:-]|\.\d)/,
  /** 「予約は 12番です」のようにラベルと「N番」の間に短い語が入る形 */
  acceptNoBan: /(?:受付|予約|整理)[^\d\n]{0,8}?(\d{1,6})\s*番(?![号目地線手組])/,
} as const;

/** 共通エラーモーダル (useErrorModal) */
export const ERROR_MODAL = {
  root: "section.ipk-exception-error",
  body: ".ipk-exception-error-body",
  close: "section.ipk-exception-error .modal-btn-area button",
} as const;

/** サーバー全画面エラー */
export const SERVER_ERROR = ".ipk-server-error";
