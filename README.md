# DSH Go 记账（@rodrick278/dsh-go-ledger）

给 [DSH Go](https://go.dshtui.com/) 手机 App 用的本地记账插件：手动记一笔、截图识别入账、按天看流水。数据只存在本机。

## 功能

- 输入框上方「记一笔」胶囊，打开原生记账面板
- 支出 / 收入、分类、备注、日期，金额走系统数字键盘
- 流水按天分组，每天一条「支出 / 收入」小结
- 点流水任意一条可以改金额、分类、备注或删除
- 「上传截图记账」：从相册选一张账单截图，识别后入账；保存后会问要不要删掉这张截图
- 不统计总资产、结余

## 安装

在 DSH Go 的插件市场里搜「记账」，或：

```sh
dsh plugin --profile web add @rodrick278/dsh-go-ledger
```

需要 DSH Go 1.0.10 及以上（选图用到 `files` 能力）。

## 数据

- 账本：`$DSH_HOME/dsh-go/ledger/records.json`
- 截图副本：`$DSH_HOME/dsh-go/ledger/inbox/`
- 加载时会生成 `$DSH_HOME/dsh-go/ledger/ledger` 命令，并在没有 `ledger` 技能时写入 `$DSH_HOME/skills/ledger/SKILL.md`

## 开发

```sh
node /path/to/plugin-kit/bin/check.mjs . --load
```

## 许可

MIT
