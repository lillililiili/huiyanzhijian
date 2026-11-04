# ODM01 设备侧 HTTP 与平台接入边界

2026-11-02，已实现、隔离自测通过，待部署/用户验收。原件：临时文件夹/开发规划新/金属屏蔽搭盖率数据接口文档.md、铜丝屏蔽间隙测量数据接口文档.md。用户确认其余未知项暂缺。

设备源是被查询服务，平台1.0是接收服务。M08连接两者，业务侧不直接解释厂商字段。共用实现与运行配置见[适配器说明](../../adapters/inspur/http/README.md)。

|来源|查询路径|测量字段|内部指标|内部原文版本|
|---|---|---|---|---|
|搭盖|/sys/copperStrip/getRealTimeData|buildPercent|SHIELD_OVERLAP_RATE|inspur-overlap-http.v1|
|间隙|/sys/copperStrip/getGapRealTimeData（原件建议，待确认）|dataType=GAP时buildWidth|WIRE_GAP|inspur-gap-http.v1|

两项请求字段lineId/startTime/endTime/limit/page，间隙追加dataType；响应code/msg/data/success/timestamp/count。count为总数；data为数组。模拟器字段名、JSON类型、包络一致。POST、UTC+08、毫秒时间、百分数、毫米与额外模拟鉴权头均为TEST_ONLY约定。

M08配置明确设备、来源lineId、平台任务、比例/单位、时间字段、来源端点和环境。任务绑定由现有分配/确认接口冻结；不因查询到同工单编号就自动关联盘。raw以vendor_record_json保存完整供应商行，数值通过显式映射产生；未经确认单位、缺值和非法量不产生有效合格值。图片URL仅存原文，PITCH不进入间隙，controlStatus不解释为质量或控制命令。

旧overlap-sim.v1 / wire-gap-sim.v1历史队列仍可原键补传；新采样不使用旧源格式。M04公开接口、判定、投影、PG/时序边界不变。017是M01设备能力格式注册增量，不代表真机、图像代理或生产限值批准。

限制：本轮无现场设备/MES联调；独立采集器为固定查询窗口的有界命令，未交付常驻调度和配置网页。供应商实际分页稳定性、迟到补传窗口、状态枚举、原始图像访问鉴权和容量仍须确认。
