# Agent Note: Webserver 错误状态分类——客户端 400、内部 500，以及收窄的 SPA 未命中

Status: implemented

[English](2026-08-14-http-error-status-classification.md) | 中文

## 问题

两条相邻的 HTTP 错误处理路径掩盖了真正的服务端故障。SPA dist 服务器捕获了每一次 `readFile(target)` 拒绝并返回 `index.html` 与 HTTP 200，于是权限错误或描述符耗尽看起来像一次成功的页面加载。webserver 请求守卫则在响应头发出之前，把每个被拒绝的 route 或 fallback handler 都应答为 HTTP 400，内部 handler 异常因此被报告成客户端错误。两者都隐藏了原始原因，并在下游浏览器中造成令人困惑的失败。

## 决策

**`BadRequestError` 是请求守卫处显式的客户端错误契约。** webserver 导出 `BadRequestError extends Error`；route 或 fallback handler 恰好只在客户端输入本身畸形时抛出它（格式错误的百分号转义、无法解析的请求目标）。守卫对 `BadRequestError` 应答 400，对其余所有拒绝应答 500——绝不返回 400，也绝不退出进程——响应头已发出时销毁连接，日志与隔离处理保持不变。两个为服务而解码 URL pathname 的解码点（`frontend-static` 的 fallback 与 `client-modules` 的 bundle route）都把自己的 `decodeURIComponent` 失败包装成 `BadRequestError`；webserver 自己的请求目标解析也做同样的分类。

**SPA 回退只接受有意的未命中。** `frontend-static` 仅对 `ENOENT`（路径不存在）和 `EISDIR`（根目录下的真实目录）以 200 回退到 `index.html`；所有其他读取失败——`EACCES`、`EMFILE`、瞬时 I/O——都会传播到请求守卫并应答 500。

## 备选方案

- **在守卫处按 `URIError` 内建对象分类**——无需新类型，但信号是隐式的：任何因非请求原因抛出 `URIError` 的 handler（例如对孤立代理项调用内部 `encodeURIComponent`）都会被误报为客户端错误。具名类在边界处点明契约，与该包现有的错误类约定一致。
- **保留宽泛回退并把所有拒绝都映射为 500**——任何错误都回退到 index 的路径仍会把损坏的 dist 掩盖成成功的 SPA 外壳；400 分支则会丢失合法的畸形百分号场景。
- **让 `client-modules` 的解码不加分类地直接抛出**——其畸形的 bundle URL 会从 400 回退成 500；分类契约必须统一覆盖每个解码点。

## 后果

- 真正的 SPA 未命中仍以 200 渲染 `index.html`；损坏的静态读取现在以 500 浮出水面，而不是成功的壳；内部 handler 失败以 500 而不是 400 呈现。
- `client-modules` 新增了对 webserver 包的运行时导入（`BadRequestError`），使该 manifest 中 webserver 从 devDependencies 移入 peerDependencies；组合始终同时挂载两者。
- 错误响应保持无响应体，服务器在每次已分类的失败后继续存活；本变更不引入任何模型可见或持久化行为。
