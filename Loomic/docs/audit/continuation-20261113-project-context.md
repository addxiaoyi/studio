# 2026-11-13 统一工程中心续作

## 本轮实现

- `/api/project-context` 在返回工程上下文时，会优先查找当前 workspace/canvas 的未完成 Agent 目标（草稿、运行中、等待审批、等待桌面或暂停）。
- `ProjectViewNav` 优先显示真实目标摘要作为“下一步”；没有活动目标时回退到视图流程建议。
- 项目名称、当前视图、画布/会话身份和并发 revision 写入逻辑保持不变。

## 验证

- Shared contracts：33 项通过。
- Web project-context：10 项通过，包含活动 Agent 目标优先展示。
- Server TypeScript 检查通过。
- Server project-context 单元回归 2/2 通过：活动 Agent 目标被返回为动态下一步，无活动目标时安全返回空值。
- 试图运行 PostgreSQL 集成回归时，本机连接先因 SCRAM 密码未配置失败；随后临时 PostgreSQL 集群无法绑定测试端口（端口已被占用），未将该集成测试计为通过，临时集群已清理。

## 边界

- 本轮未执行生产数据库迁移、部署或真实登录浏览器验收；PostgreSQL 生产兼容性仍需隔离恢复库或授权生产只读探针验证。
