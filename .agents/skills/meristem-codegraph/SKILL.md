---
name: meristem-codegraph
description: Use when exploring code structure, tracing call chains, finding symbol definitions, assessing change impact, or answering architecture questions in the Meristem codebase. Provides CodeGraph usage discipline as a replacement for repetitive grep/read loops.
---

# Meristem CodeGraph Usage

## 使用时机

Agent **必须优先使用 CodeGraph** 代替手动 grep/read 探索的场景：

### 1. 结构性问题（**首选**）
回答 "X 是怎么工作的？"、"Y 和 Z 什么关系？"、"这个模块的架构是什么？" 等结构性问题时，**必须先调用 CodeGraph**，而不是直接发起 grep/read。

```text
codegraph_explore(query="how does AuthService work")
codegraph_explore(query="session-manager refresh flow")
```

### 2. 编辑前的第一选择（**强制**）
在修改任何符号之前，使用 CodeGraph 了解：
- 符号定义位置和签名
- 调用者（哪些地方依赖它）
- 被调用者（它依赖什么）

```text
codegraph_node(symbol="SomeFunction", includeCode=true)
// 同时返回定义源码 + 调用者/被调用者列表
```

### 3. 读文件（替代 Read 工具）
用 `codegraph_node(file="path/to/file.ts")` 替代 `Read` 工具，因为它同时返回：
- 带行号的文件源码（等效 Read）
- 依赖关系信息（哪些文件依赖它）

### 4. 影响半径分析
修改前评估改动会波及哪些文件：

```text
codegraph_callers(symbol="SomeFunction")
// 列出所有调用该符号的位置
```

### 5. Bug 调查
追踪调用路径，快速定位问题范围：

```text
codegraph_explore(query="how does the publish flow work")
// 一次调用获取完整调用链上的所有相关符号源码
```

## 可用工具

| 工具 | 用途 | 替代什么 |
|---|---|---|
| `codegraph_explore` | 自然语言问题 / 多符号分析 | 多个 grep + Read 轮次 |
| `codegraph_node` | 读文件 或 查单个符号（含调用链） | Read 工具 |
| `codegraph_callers` | 列出调用某符号的所有位置 | grep "symbolName" |
| `codegraph_search` | 快速符号名搜索 | — |

## 什么时候不用 CodeGraph

| 场景 | 改用 |
|---|---|
| 全文/正则搜索不记得名字的模式 | `grep` / `explore` agent |
| 查外部文档或开源示例 | `librarian` agent / websearch |
| 架构决策、复杂调试、设计权衡 | `oracle` agent |
| 跨多个不相关模块的大范围浏览 | `explore` agent（后台并行） |

## 优先级规则

```
codegraph_explore(codegraph_node)  // 第一选择
  → codegraph_callers/codegraph_search  // 精确符号查询
    → grep / explore agent  // 模式搜索
```

**关键原则**：CodeGraph 能从索引直接回答的问题，永远不要通过手动 grep + 打开多个文件的循环来解决。一次 `codegraph_explore` 调用通常抵得上 5~10 次 grep/read 轮次。
