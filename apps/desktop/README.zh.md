# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

独立 GUI 外壳：一个 Electron 主进程，启动与 CLI 完全相同的 `web` profile 组合，并在原生窗口中原样渲染官方 WebUI。外壳本身不增加任何产品表面——窗口只是不同的载体和窗口装饰，而不是不同的应用。

## 启动方式

主进程（`src/main.ts`）通过 CLI 使用的共享 profile-boot 胶水（`@deepseek-ai/dsh/profile-boot`）启动 `web` profile，并使用 CLI 的安装锚点与随附 agent-preset 根目录，因此组合、所服务的 `apps/web` dist 以及每个标志的默认值都按构造保持一致。Loader 树稳定后，外壳读取已绑定的回环端口，并在规范 URL（`http://127.0.0.1:<port>`）打开 `BrowserWindow`；窗口与浏览器的连接方式完全相同——所服务的 `index.html`、注入的 `window.__DSH_BOOT__` 入口图、客户端插件树以及就绪握手。

窗口关闭映射到 CLI 的有界关闭：关闭 `BrowserWindow` 不会发出信号，因此外壳拦截 Electron 的生命周期（`window-all-closed` / `before-quit`），调用 `runProfile` 返回的同一个关闭控制器，等待根目录销毁，然后退出。

## 参数

外壳只拥有一个启动器标志 `--patch <path>`（可重复，与 `dsh` 启动器契约相同）；第一个不属于 `--patch` 对的部分之后的令牌开始 Web 应用的参数，并原样转发：

```sh
dsh-desktop --patch ./extra.yml --port 8080
```

`--host`、`--port` 和 `--trusted-host` 的行为与 `dsh --profile web` 完全相同（包括 `--port 0` 让操作系统选择空闲端口）。

## 开发

```sh
pnpm run build          # repository root: builds libs and the web frontend dist
pnpm --filter @deepseek-ai/dsh-desktop run start
```

生产运行需要已构建的包和前端产物；start 脚本通过工作区解析两者。

桌面冒烟测试通道在封闭的临时世界中运行真实外壳，并将其种子会话转录与浏览器载体进行比较：

```sh
pnpm run test:desktop
```

在 Electron 无法打开窗口的环境（没有二进制，或 Linux 上没有显示）中，该测试通道会自动跳过。

## 已知限制与待办工作

- **仅限开发启动。** 打包、签名以及随附 agent-preset 目录的打包布局属于 GUI-05；外壳目前从工作区解析 CLI 的随附预设。
- **回环 HTTP 载体。** 桌面路径保持在 webserver 已服务的回环 HTTP 源上；IPC 载体是单独的传输决策，可能涉及 `connection` 包或其目录行。
- **初始语言环境。** WebUI 从操作系统派生初始语言环境，正如浏览器 WebUI 从浏览器派生一样；设置中存储的偏好会覆盖它。
