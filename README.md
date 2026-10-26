# iticket-appoint

[アイチケット広場](https://park.paa.jp/park2) の予約を、あらかじめ設定した医院・患者情報 (氏名・診察券番号・生年月日・電話番号) で自動入力して取る CLI です。
ブラウザ (Playwright / Chromium) で実際の画面を操作します。GitHub Actions に載せてスマホから実行することもできます。

- 既定は **お試し (dry-run)**: 確認画面まで進めてスクリーンショットを撮り、そこで止まります。`--submit` を付けたときだけ「予約する」を押します。
- 受付開始時刻まで待ってから、低頻度 (既定 20 秒間隔・下限 10 秒) で受付開始を確認する待機モードがあります。
- 予約ボタンは 1 回しか押しません。押した後に結果が確認できなかった場合も再送せず、手動確認を促します (二重予約防止)。
- 現状は **当日の順番予約** のみ対応です。
- 入力欄は画面の項目を読み取って設定値を当てはめます。医院が必須にしている項目の値が設定にないと、送信前に止まります (終了コード 3)。医院独自の項目は `custom_fields` に「項目名: 値」で書きます。
- 初診の人は `new_patient: true` にすると、診察券番号欄に「新患」と入力します。

## 利用上の注意

アイチケット広場の [利用規約](https://app.iticket.co.jp/prd/park_web_rules/) は、サービスへの過度な負荷・運営の妨害などを禁止しています。このツールは通常の画面操作を 1 回ずつ行うだけにとどめ、待機中の確認間隔にも下限 (10 秒) を設けています。間隔を詰めたり、多数の予約に使ったりしないでください。

## セットアップ (ローカル)

```sh
pnpm install
pnpm exec playwright install chromium
cp config.example.yaml config.yaml   # 医院・患者情報を記入 (git 管理外)
pnpm cli check-config          # 設定の検証 (個人情報はマスク表示)
```

## 使い方

```sh
# 待ち状況を見る (読み取りのみ)
pnpm cli status

# お試し: 確認画面まで進めて止まる (artifacts/<日時>/ にスクリーンショット)
pnpm cli book --patient taro --wait-until now --headed

# 本当に予約する (確認プロンプトあり。--yes で省略)
pnpm cli book --patient taro --submit

# 2 人まとめて
pnpm cli book --patient taro --patient hanako --submit

# 9:00 まで待ってから予約。受付前なら 20 秒ごとに再確認、9:30 で諦める
pnpm cli book --patient taro --submit --yes --wait-until 09:00 --deadline 09:30
```

### 患者の選び方

`config.yaml` には家族全員を `patients` に登録しておき、予約するたびに `--patient` で選びます。1 人だけ予約するために config を分ける必要はありません。

- `--patient taro` → taro だけ (1 人分の予約)
- `--patient taro --patient hanako` または `--patient taro,hanako` → 2 人まとめて (人数 2 で 1 回の予約)
- 省略 → `defaults.patients` の人たち

Actions では「予約する」の `patients` 入力に `taro` や `taro,hanako` と書きます。

### お試し (dry-run) と本番

|         | お試し (既定)                                                        | 本番                                                    |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| 指定    | `--submit` を付けない                                                | `--submit` (対話で y、または `--yes`)                   |
| Actions | `submit` をオフ                                                      | `submit` をオン                                         |
| 動き    | 枠を選び、入力して確認画面まで進み、**「予約する」を押さずに止まる** | 確認画面の内容を照合してから「予約する」を 1 回だけ押す |
| 記録    | 予約記録 (ledger) は残さない。何度でも実行できる                     | 押す直前に記録し、同じ日・同じ患者の再実行を止める      |

おすすめの流れ: まず `pnpm mock` (下記) でダミーの画面に対する動きを確かめ、受付時間中に一度実サイトでお試しをして確認画面まで進むことを確かめ (`--headed` で画面を見られます)、予約したい日は本番で実行します。お試しも実際のサイトを操作します (予約はされません)。

### ダミーの画面で試す (`pnpm mock`)

実サイトにはアクセスせず、手元で起動するダミーの予約サイト (E2E テスト用のモック) とダミー患者 `a` / `b` で `book` を実行します。`book` のオプションをそのまま渡せます。

```sh
pnpm mock                          # 患者 a でお試し (確認画面で止まる)
pnpm mock --patient a,b --headed   # 2 人・ブラウザ表示
pnpm mock --submit --yes           # モック相手に「予約する」まで押す
pnpm mock --serve                  # モックサイトだけ起動 (Ctrl-C で終了)
```

スクリーンショット等は `artifacts/mock/` に保存されます。予約記録は毎回使い捨てなので、何度でも実行できます。

主なオプション (`pnpm cli book --help` で全部):

| オプション                                 | 説明                                                              |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `--clinic <key>`                           | 医院 (省略時 `defaults.clinic`)                                   |
| `--patient <key...>`                       | 患者。複数指定・カンマ区切り可 (省略時 `defaults.patients`)       |
| `--frame <text>`                           | 枠名の部分一致 (例: `午前`)                                       |
| `--submit` / `--yes`                       | 実際に予約する / 確認プロンプトを省略                             |
| `--wait-until <HH:MM\|now>`                | この時刻まで待つ (省略時 `defaults.wait_until`、過ぎていれば即時) |
| `--interval` `--max-attempts` `--deadline` | 待機モードの再試行設定 (省略時 `wait.*`)                          |
| `--once`                                   | 再試行せず 1 回だけ試す                                           |
| `--headed` / `--trace`                     | ブラウザ表示 / Playwright trace 保存                              |
| `--force`                                  | 同じ日の予約記録 (state/ledger.jsonl) があっても実行              |

終了コード: `0` 成功 (お試しで確認画面まで到達を含む) / `2` 受付が始まらない・諦めた / `3` 入力・設定の不備 / `4` 予約ボタン押下後に結果不明 (手動で確認してください) / `5` 予約済み・満枠・受付終了 / `1` その他

## GitHub Actions で使う (スマホから実行)

1. このリポジトリを fork するか、自分の GitHub に置く。一緒に使う人は collaborator (Write 権限) として招待する (workflow の手動実行には Write 権限が必要)。
2. Settings → Secrets and variables → Actions に登録:
   - `CONFIG_YAML`: `config.yaml` の中身全文
   - `NOTIFY_URL` (任意): 結果の通知先。[ntfy](https://ntfy.sh/) の推測されにくいトピック URL (例 `https://ntfy.sh/iticket-xxxxxxxx`) か Discord の webhook URL。ntfy ならスマホに ntfy アプリを入れて同じトピックを購読する。
3. まず Actions → 「待ち状況を見る」→ Run workflow で、Actions のサーバーからサイトが見えるか確認する。
4. Actions → 「予約する」→ Run workflow (スマホは GitHub アプリの Actions タブから)
   - `patients`: `taro` や `taro,hanako` (空なら defaults)
   - `wait_until`: `09:00` など (空なら defaults、`now` ですぐ)
   - `submit`: **オンで本当に予約**。オフはお試し
5. 結果は通知と、実行ログ・Artifacts (枠一覧などのスクリーンショット、3 日で削除) で確認できる。
6. 「結果不明」の通知が来たら **再実行せず**、アイチケットの画面や医院で予約できているか確認する。同じ日に「予約する」を押した記録 (`state/ledger.jsonl`、Actions では cache で引き継ぎ) があると、同じ患者での再実行は止まります (`--force` で解除)。

注意: このリポジトリは public なので、Actions のログと Artifacts は誰でも見られます。ログには患者のキー (taro など)・医院名・枠名が出ます (キーに本名を使わないでください)。`book.yml` では `ITICKET_REDACT=1` を設定しており、入力内容が写る画面 (入力・確認・完了・入力後のエラー) のスクリーンショット/HTML と確認画面の本文は Artifacts に保存しません。そのため、確認画面の中身は通知とログ (「確認画面に到達しました」) でしか確かめられません。画面を見たいときはローカルで `--headed` を付けて実行してください。

毎朝自動で予約したい場合は `.github/workflows/book.yml` の `schedule` のコメントを外します (cron は UTC・遅延があるので受付開始の 30 分前程度に起動)。public リポジトリなら Actions の実行時間は無料です (private にすると無料枠は月 2000 分)。

## 開発

```sh
pnpm test           # unit + DOM テスト (DOM テストはローカルの Chromium を使用)
pnpm test:e2e       # モックサイトに対する E2E (CLI を子プロセスで実行。30 秒ほどかかる)
pnpm typecheck
pnpm lint           # oxlint
pnpm format         # oxfmt で整形 (確認だけなら pnpm format:check)
```

画面のセレクタは `src/site/selectors.ts` に集約しています。サイトの画面が変わったら、まずここを直してください。各ステップの HTML/スクリーンショットは `artifacts/` に残ります。
