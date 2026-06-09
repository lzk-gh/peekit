- # Peekit AI-First Plan

  ## Summary

  **Peekit** 是一个全面面向 AI Agent 的跨端运行态探针。它不是给开发者手动使用的 CLI 工具，而是给 vibecoding / agentic coding 流程提供真实运行态证据。

  核心目标：

  - 开发者用自然语言提出问题。
  - Agent 自动调用 Peekit MCP。
  - Peekit 自动读取 H5 / 小程序运行态。
  - Agent 基于真实证据定位、修改、复查。
  - 开发者不需要记任何命令。

  定位语：

  ```txt
  Peekit
  Runtime eyes for AI agents.
  ```

  产品原则：

  - MCP 是唯一一等入口。
  - 不设计面向人类的 CLI 工作流。
  - npm 只作为 MCP server 分发载体。
  - 配置、诊断、抓取、对比都通过 MCP tools 暴露给 agent。
  - 文档主要写给 AI 工具和 agent，而不是传统开发者。

  ## Product Shape

  项目结构：

  ```txt
  peekit/
    README.md
    PLAN.md
    package.json
    pnpm-workspace.yaml
    packages/
      core/
      mcp-server/
      adapter-h5/
      adapter-mp-weixin/
      adapter-mp-alipay/
      adapter-mp-bytedance/
      adapter-mp-qq/
      reporter/
    docs/
      ai-usage.md
      mcp-install.md
      agent-contract.md
      capability-matrix.md
      adapter-authoring.md
    examples/
      h5-basic/
      mp-weixin-basic/
  ```

  开发者安装体验：

  ```json
  {
    "mcpServers": {
      "peekit": {
        "command": "npx",
        "args": ["-y", "peekit", "mcp"]
      }
    }
  }
  ```

  开发者真正的使用方式：

  ```txt
  帮我检查这个按钮为什么在微信小程序里点击后没有 loading 状态。
  ```

  ```txt
  对比这个页面在 H5 和微信小程序里的实际间距、颜色和可见状态。
  ```

  ```txt
  修复后用 Peekit 复查，不要只看源码判断。
  ```

  ## MCP Interface

  Peekit 只暴露 AI 工具接口，不提供人类 CLI 命令作为核心产品。

  ### Core Tools

  ```txt
  peekit_inspect_environment
  peekit_list_targets
  peekit_connect_target
  peekit_get_current_page
  peekit_open_page
  peekit_query_element
  peekit_query_all
  peekit_capture_snapshot
  peekit_perform_interaction
  peekit_compare_snapshots
  peekit_diagnose_issue
  peekit_suggest_next_probe
  peekit_record_case
  peekit_replay_case
  ```

  ### Agent Flow

  标准 agent 闭环：

  ```txt
  understand user issue
  -> inspect environment
  -> connect target runtime
  -> open page or detect current page
  -> query relevant elements
  -> capture runtime snapshot
  -> perform interaction if needed
  -> capture after snapshot
  -> compare evidence
  -> diagnose likely cause
  -> modify code
  -> recapture
  -> report measured result
  ```

  Agent 不应输出“请你运行某命令”。  
  Agent 应该直接调用 Peekit 完成探测。

  ## Runtime Evidence Model

  统一输出结构：

  ```ts
  type RuntimeEvidence = {
    target: string
    capabilityLevel: 0 | 1 | 2 | 3 | 4
    page: {
      url?: string
      route?: string
      title?: string
      query?: Record<string, string>
      viewport?: { width: number; height: number }
      scroll?: { x: number; y: number }
    }
    element?: {
      selector: string
      tag?: string
      text?: string
      className?: string
      attributes?: Record<string, string>
      markup?: string
      rect?: { left: number; top: number; width: number; height: number }
      styles?: Record<string, string>
      state?: Record<string, unknown>
    }
    interaction?: {
      action: 'tap' | 'click' | 'input' | 'scroll' | 'hover'
      before?: unknown
      after?: unknown
    }
    console: Array<{ type: string; text: string }>
    errors: Array<{ source: string; message: string; stack?: string }>
    unsupported?: Array<{ field: string; reason: string }>
  }
  ```

  设计重点：

  - Agent 必须拿到可引用的证据，而不是模糊截图。
  - 文本、尺寸、样式、滚动、class 变化是核心数据。
  - 不支持能力必须显式说明原因。
  - 所有结果都应适合 agent 直接用于推理和最终回复。

  ## Implementation Plan

  ### Phase 1: AI-First MVP

  实现一个可被 agent 直接调用的 MCP Server：

  - `core`: schema、adapter interface、capability matrix、snapshot diff、error normalization。
  - `mcp-server`: 暴露全部 Peekit tools。
  - `adapter-h5`: 基于 Playwright 抓 DOM、text、rect、computed styles、console、click/input/scroll。
  - `adapter-mp-weixin`: 抓 WXML、text、offset、size、style、route、tap、scroll、console。
  - `reporter`: 生成 agent-readable JSON 与简短 Markdown evidence summary。
  - README 只讲 MCP 安装和自然语言使用方式，不主推 CLI。

  ### Phase 2: AI Setup Assistant

  让 agent 能自动完成项目接入：

  - `peekit_inspect_environment`: 检测项目类型、dev server、构建产物、小程序配置、可用端口。
  - `peekit_suggest_target_config`: 推断 H5、小程序 target 配置。
  - `peekit_validate_target`: 验证运行时是否可连接。
  - `peekit_explain_setup_blocker`: 用自然语言解释缺什么，例如浏览器未安装、DevTools 自动化端口未开、目标页面不可达。

  开发者体验目标：

  ```txt
  用户：帮我给这个项目接入 Peekit
  Agent：自动检查环境 -> 写 MCP 配置建议 -> 验证连接 -> 告诉用户可以直接问 UI 问题
  ```

  ### Phase 3: 多小程序能力矩阵

  采用 adapter capability 分级，不要求所有平台首版能力完全一致：

  ```ts
  type AdapterCapabilities = {
    launch: boolean
    queryElement: boolean
    getMarkup: boolean
    getText: boolean
    getRect: boolean
    getStyle: boolean
    tap: boolean
    input: boolean
    scroll: boolean
    console: boolean
  }
  ```

  平台优先级：

  1. H5
  2. 微信小程序
  3. 支付宝小程序
  4. 抖音/字节小程序
  5. QQ 小程序
  6. 百度、快手等后续补齐

  ### Phase 4: Problem Solving Layer

  增加真正提高 agent 解决问题能力的工具：

  - `peekit_diagnose_issue`: 根据证据输出可能原因。
  - `peekit_suggest_next_probe`: 证据不足时建议下一步抓什么。
  - `peekit_compare_snapshots`: 对比修复前后变化。
  - `peekit_record_case`: 记录可复现问题现场。
  - `peekit_replay_case`: 复现历史问题。
  - `peekit_cross_target_compare`: 对比 H5 与小程序运行态差异。

  诊断输出示例：

  ```json
  {
    "problem": "tap did not trigger loading state",
    "evidence": [
      "before className: submit-button",
      "after className: submit-button",
      "console errors: []",
      "tap target rect: { width: 88, height: 36 }"
    ],
    "likelyCauses": [
      "event handler did not fire",
      "selected element is not the actual tap target",
      "loading state changed but class binding did not update"
    ],
    "nextProbes": [
      "capture parent component state",
      "tap inner text node",
      "inspect emitted events after tap"
    ]
  }
  ```

  ## Test Plan

  - MCP contract tests: 所有 tools 输入输出稳定。
  - Core tests: schema、capability、snapshot diff、unsupported 字段。
  - H5 integration tests: DOM、text、rect、style、console、click、input、scroll。
  - 小程序集成测试: route、WXML、text、offset、size、style、tap、scroll。
  - Agent acceptance scenarios:
    - 元素存在但不可见。
    - 点击后状态未变化。
    - 表单错误提示位置异常。
    - 弹层遮挡或层级异常。
    - H5 与小程序样式不一致。
    - 滚动联动失效。
    - 修复后自动复查并报告 before/after 数值。

  ## Release Plan

  首发渠道：

  - GitHub: 源码、issue、roadmap、examples。
  - npm: 仅作为 MCP server 分发方式。
  - MCP Registry: 让 AI 工具自动发现 Peekit。
  - 文档站: 面向 agent 的使用协议、能力矩阵、接入说明。

  README 首页只保留 AI-first 使用路径：

  ```txt
  1. Add Peekit as an MCP server.
  2. Ask your coding agent to inspect runtime UI.
  3. Let the agent capture, diagnose, fix, and verify.
  ```

  MCP 配置示例：

  ```json
  {
    "mcpServers": {
      "peekit": {
        "command": "npx",
        "args": ["-y", "peekit", "mcp"]
      }
    }
  }
  ```

  ## Assumptions

  - Peekit 是 AI-first 工具，不设计传统 CLI 作为主要体验。
  - 开发者通过自然语言驱动 Peekit，而不是手动运行 probe 命令。
  - MCP 是唯一一等公共接口。
  - npm 只是安装和运行 MCP server 的分发载体。
  - 项目核心卖点是让 agent 获得真实运行态证据，并完成问题定位与修复验证闭环。
