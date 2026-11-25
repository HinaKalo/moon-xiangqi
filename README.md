# 中国象棋

在 GameHub 创建房间，把邀请链接或 8 位房号发给好友。好友查看房间设置并确认入座后开局。房主执红，标准开局红方先行。席位保存在浏览器 Cookie 里，重开同一个房间链接可以回座。两个席位坐满后，邀请链接不能新增玩家。

- 开房可选不限时，或每方 1、3、5、10、15、30、60 分钟。好友入座后先行方开始计时，走子后换表。开局连走使用同一方的钟。断线、重启和等待确认期间计时继续，超时由 Moon 判负。
- 双方均可申请悔棋或求和。对方确认后才生效。悔棋退回申请方最近一次走子之前，已经用掉的时间照计。新走子会使待确认申请失效。
- 让子可选红方或黑方，让单马、双马、单车、车马或双车。让先可选红方或黑方先走 1 至 3 步，先行方将军时立即交给对手。再战换边时，让子和让先跟随原玩家，标准开局仍为红先。

对局结束时，SQLite 一并保存结果与棋谱。可以从「我的棋谱」复盘，或将 ICCS 坐标记谱的 PGN 下载到本地。复盘链接可单独分享，持有链接的人可以回看或下载。棋谱保留在服务端，个人棋谱索引保存在当前浏览器。无活动且无人在线的房间 7 天后清理，已保存的棋谱独立保留。

连走棋局的网页复盘包含每一步。PGN 行棋正文从最后一次连走交接前的局面开始，前缀走子保存在 `OpeningMoves` 标签中，最初局面保存在 `OpeningFEN` 标签中。普通 PGN 导入工具可从 `FEN` 指定的正文起点读取余局。

走子使用 [xiangqi.js](https://github.com/lengyanyu258/xiangqi.js/tree/f9019ac2303d4b80ef0b82fd0515bfb55a80a62b)，固定在提交 `f9019ac`。上游代码和 [BSD-2-Clause 许可证](./vendor/LICENSE)位于 `vendor/`。将死、困毙判负。和棋采用引擎判定，包括三次重复。长将和长捉按重复局面处理，未实现赛事专用裁决。

## 本地运行

用 Node.js 24 或更高版本运行 `npm start`，打开 `http://127.0.0.1:18798/`。使用两个独立浏览器会话测试红黑两方。可通过 `PORT` 和 `DB_PATH` 指定测试端口与数据库，改端口后用相应的本地地址打开。

## Moon 部署

将 `server.cjs`、`public/` 与 `vendor/` 放入 `/opt/xiangqi/releases/<版本>/`。将 `/opt/xiangqi/current` 切到经过验证的版本，安装 [systemd 单元](./gamehub-xiangqi.service)并重启 `gamehub-xiangqi.service`。服务复用 Moon 的 Node 24 运行时。SQLite 文件位于 systemd 的 `/var/lib/gamehub-xiangqi/` 状态目录，独立于发布目录。

按 GameHub 的发布流程（不在本仓库）发布入口卡片。Caddy 的 `handle /gamehub/xiangqi/*` 放在静态 GameHub 路由之前，保持原始请求路径并反代到 `127.0.0.1:18798`。通过 `/gamehub/xiangqi/health` 检查服务，使用两个独立会话验证开房、开局、走子与复盘。回退应用时换回之前的应用链接并重启服务。

`gamehub-xiangqi.service` 写死了 moon 的环境：Node 运行时路径（借用 `/opt/pokemon-showdown/runtime/current/bin/node`）、
发布目录 `/opt/xiangqi/current` 和公网来源 `https://release.moonl.cloud`。在别处部署时按实际环境修改。

## CI

项目没有 npm 依赖、构建步骤和自动化测试。GitHub Actions 在每次推送和 PR 时运行标准 Node 检查（目前只有安装）以及密钥与依赖漏洞扫描。

## 许可证

本仓库代码以 [MIT](LICENSE) 发布。`vendor/xiangqi.cjs` 来自 lengyanyu258 的 xiangqi.js，保留其 BSD-2-Clause 许可证与版权声明（[vendor/LICENSE](vendor/LICENSE)），详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
