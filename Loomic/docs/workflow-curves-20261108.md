# 工作流柔和连线

将两点直线替换为采样三次曲线，保留Excalidraw原生箭头及绑定。节点之间水平空间足够时从相对侧边出入，上下排列时改从上下边缘连接；反向连接使用面对彼此的边缘。端点方向平滑过渡，使用较轻的中性色线条。交付结果的虚线采用同一几何规则。

拖动或缩放节点时按动画帧刷新几何，不再等工作流120ms保存同步才校正。只处理带工作流标识的箭头，普通画布连线不变。刷新不增加撤销记录，不创建生成任务、不触碰计费。

单元测试16项通过，覆盖水平/上下/反向排列、重合及旋转节点、坐标范围、刷新幂等、原生场景投影和素材嵌入。Web类型检查、静态生产构建通过。Chromium已验证节点拖动、撤销重做、保存刷新和连线关系恢复（42.6秒）。Windows 0.2.21隔离候选进一步验证曲线命中选择、Delete删除、原生撤销恢复、设置面板断开/撤销和保存，1条通过（51.9秒）；同版素材拖入测试通过（13.9秒）。测试未创建生成任务。

证据日志：`M:/loomic-builds/workflow-curves-browser.log`、`workflow-curves-desktop-review.log`、`workflow-curves-web-build.log`。截图位于 `Loomic/.creative-test-results/workflow/workflow-curves-curved-wir-1adfb-ve-native-undo-and-deletion/workflow-curves-final.png`。
