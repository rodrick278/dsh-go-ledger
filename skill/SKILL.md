---
name: ledger
description: 记账：把用户的一句话或一张截图（付款、订单、红包、账单）记成收支记录，读写本机账本。用户说「记一笔」「午饭 25」「截图记账」「识别这张图记一下」「最近记了什么」「删掉那笔」时使用；配合 dsh-go 的「记账」面板。
whenToUse: 用户要记收入/支出、按截图或账单记账，或者要查、删账本记录。不是做财务分析、资产统计或预算规划。
---

# 记账

账本是一份 JSON，dsh-go 的「记账」面板和这个命令行共用：

- 账本：`$DSH_HOME/dsh-go/ledger/records.json`（默认 `/root/.dsh/dsh-go/ledger/records.json`）
- 命令行：`"$DSH_HOME/dsh-go/ledger/ledger"`（插件加载时会生成这个脚本；如果不存在，用 `node "$DSH_HOME/dsh-go/plugins/local-ledger/bin/ledger.mjs"`）
- 面板：输入框上方「记一笔」胶囊，或对话详情页「插件 › 记账」

## 记一笔

1. 从用户的话或截图里取出：金额、收/支、分类、备注/商家、时间。
2. 写入：

```sh
"$DSH_HOME/dsh-go/ledger/ledger" add \
  --amount 25.5 --type expense --category 餐饮 --note 午饭 \
  --time 2026-11-04T12:30
```

3. 回一句确认 + 关键字段，并告诉用户记错可在面板里删。

## 截图记账

用户发来截图路径，或只说「记账」「识别一下」：

1. 找图：消息里有路径就用；没有就运行 `ledger latest-shot` 取相册最新截图。
2. 用 read_image 真读这张图，不要根据文件名猜。
3. 取数规则：
   - 金额：实付 / 合计，**不要**取余额、总资产、优惠前金额、累计；
   - 收支：付款、消费 → `expense`；收款、红包、退款、工资、到账 → `income`；
   - 分类：餐饮、交通、购物、日用、娱乐、医疗、房租、水电、工资、红包、退款、兼职、其他；
   - 备注 / 商家：店名或商品名，12 字以内；
   - 时间：截图里能看清就用截图的时间（如「10月28日 12:30」），否则用现在。
4. 一张图里有好几笔就分条记；金额看不清或有好几个候选就问一句，别编。
5. 记完用 dsh-ui 回一张小卡片（金额、分类、时间），一句话说明。

## 截图记账后的收尾

从截图记完一笔后，问一句「要删掉这张截图吗？」（用 dsh-ui 的 confirm，或 ask_user_question，选项「删除 / 留着」）。

- 图在 `$DSH_HOME/dsh-go/ledger/inbox/` 下时，同目录的 `<文件名>.json` 里记着 `name`（相册显示名）、`bytes`、`sha256` 和 `original`（相册原图路径，插件已按内容匹配好）。
- 用户选删除：确认 `original` 在 `/sdcard/DCIM/Screenshots/` 或 `/sdcard/Pictures/Screenshots/` 下，再 `rm` 原图；同时删掉 inbox 副本和 `.json`。
- `original` 为空说明这张图不在截图目录里，只删 inbox 副本，并告诉用户没找到相册原图，不要猜路径。
- 选留着或没回应：不要删。
- 只删这一张，不要批量清理相册。

## 查 / 删

- `ledger list --today`、`--month`、`--limit 20`，每条带 id。
- `ledger delete --id rxxxx`。
- 面板首页点一条记录可以改金额/分类/备注，也可以删除。

## 规矩

- 只记真实发生的收支；不要把「总资产 / 结余 / 额度」当成一笔收入。
- 金额单位为元，保留两位小数；多笔合计时先分条。
- 不确定的字段就留空或问，不要瞎填。
- 不要清空账本，不要改 `records.json` 以外的文件。
