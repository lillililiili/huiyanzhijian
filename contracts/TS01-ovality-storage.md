# TS01 中心不圆度采样存储（2026-10-30）

本轮用户批准的范围是 OVALITY 历史采样存储拆分。M04拥有 PostgreSQL 索引和中心 InfluxDB 桶；M05/M06/M07 通过 M04 `storage-api.ts` 公开读取能力取得样本值。前端继续调用原 HTTP 查询，不持有时序库凭据。另两指标写入、查询和判定规则不变。

## 数据归属

| 数据 | 存储 |
|---|---|
| OVALITY 完整采样原文、十进制测量值、原始双轴/寄存器观测 | InfluxDB 2.9.1，ovality-samples 桶，ovality_sample measurement |
| 记录ID、工厂/设备/任务关联、采样/接收时间索引、原载荷hash、来源键及序号去重 | PostgreSQL m04.measurement_record |
| 单位、方法、窗口、有效性、存储位置标记 | PostgreSQL m04.measurement_value；外置OVALITY的value为NULL |
| 判定/资格/规则快照、任务、工单、账号、审计、报警和报告快照 | 原有PostgreSQL所属模块 |
| 搭盖率和铜丝间隙的采样原文与值 | 原有PostgreSQL，不迁移 |

PG `raw_payload` 对外置记录为 `{storage:'INFLUXDB',version:'ts01.1',point_id,content_hash}`。Influx tags为工厂hash和确定性point ID，时间为原采样时间（原契约微秒→纳秒编码）；payload为base64编码的完整JSON，数值固定10位十进制字符串或NULL。JSON包含完整原始采样时间与设备观测，不能将NULL补零。点身份包含工厂/设备/来源记录键/载荷hash，同刻多条记录不覆盖。

## 公开读取与兼容

- `hydrateMeasurementRows(factory, rows)`：调用方必须先按认证工厂选择PG索引，按引用回读原文与value，验证内容hash，保持原前端DTO字段。每组最多50点、响应体16MiB、单次8秒超时。
- `ovalityTaskStats(factory, taskIds, db, includeQuarantined=false)`：分页读取PG索引、回读时序，Decimal聚合。默认沿用批量任务摘要“有效且已存储”统计；旧单任务摘要和MES内部组包通过显式true保留各自原统计范围。本次不重新定义合格/复检/隔离业务政策。
- 查询、详情、任务摘要/末次样本、报警峰值、报告新快照、MES内部组包和人工导入都已适配。既有报告与判定快照不重算。MES外部联调未执行。
- `health/ready`新增`ovality_timeseries:UP|DOWN`。PG/worker状态独立；时序异常不会关闭另外两项。前台顶栏能显示不圆度历史存储异常。
- 仅在通过既有边缘Token鉴权、且整批只有OVALITY时，接受Go边缘批次`sent_at`的7～9位小数秒，按微秒校验其运输时间。采样`sample_time`精度及原文、其他指标的时间契约均不变。

## 提交、故障和恢复

在PG事务与既有设备去重锁内先检查重复/冲突，再等待Influx写入204，最后提交PG索引、判定、资格及outbox。两者成功才返回STORED/QUARANTINED。时序失败或缺点/内容不一致返回503 `TIMESERIES_UNAVAILABLE`、retryable=true、write_outcome=UNKNOWN；不退回PG存原值，不伪造成功或空列表。PG提交失败留下无索引时序点，查询不可见，重试相同来源键与内容复用同点，不产生重复业务记录。不存在跨库原子事务，必须按回执与来源键重传。

中心不直连或复制边缘数据库；仍使用认证HTTP。边缘本地时序写入和bbolt原始/待传保留现有实现，中心不可用时保留队列。硬件采集、公式和单位没有在本包更换。

015迁移只增加M04存储标记与约束。历史迁移工具先写Influx、回读校验，再更新PG引用；可续跑，运维角色执行，运行角色无覆盖原文权限。`relocate-ovality --restore`可从TS回填PG后回退旧后端。部署、备份和凭据操作见`docker/TS01-DEPLOYMENT.md`。

## 当前限制

当前为模拟联调自测通过待验收。Influx默认无限保留；保留期、容量、异地备份、长期高频压力和恢复时长未获生产验收。每记录point tag会增加series基数，任务聚合仍需遍历采样；正式高频上线前应依据实测数据量验证并专项优化，不能用本轮千条迁移证明长稳容量。PG和Influx及凭据须成套备份，禁止只恢复PG引用。
