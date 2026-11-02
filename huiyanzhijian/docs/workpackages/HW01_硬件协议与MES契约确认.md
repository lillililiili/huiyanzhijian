# HW01 硬件协议与 MES 契约确认

> 2026-10-28 · 阶段二交付物 · M07 / M08 / M09 契约与驱动底盘 · 7 项协议测试 100% 通过，无前端冲突。

---

## 一、 任务范围与背景

根据《后续开发计划清单_基于评估报告推进_2026-10-28.md》阶段二要求，锁定真实硬件物理通信参数与上层 MES 契约，避免盲目接入与返工。

- **责任隔离**：本工作包严格限定在硬件驱动适配层（`adapters/inspur/`）、边缘端采集规范（`apps/device-edge/`）和平台 MES 模块（`apps/platform/modules/m07-mes/`、`contracts/mes/`），**完全不触碰 `apps/web/` 前端代码**，彻底杜绝与“开发1”agent的潜在代码冲突。
- **协议依据**：参考原件 R1（铜带）、R2（笼绞）、R4（CJY）、R5（Opmac 2026/2025）、R6（浪潮产品手册）及宏亮电缆应用方案。

---

## 二、 交付规格书与驱动源码清单

| 任务编号 | 交付规格书与实现路径 | 核心成果 | 自动化测试验证 |
|---|---|---|---|
| **WP2.1** | [`adapters/inspur/SPEC_浪潮设备协议与寄存器映射.md`](../../adapters/inspur/SPEC_浪潮设备协议与寄存器映射.md)<br>[`adapters/inspur/inspur-driver.ts`](../../adapters/inspur/inspur-driver.ts) | 锁定 ISA-TD-3120（搭盖率）与 ISA-LJ-2420/3420（铜丝间隙）Modbus 寄存器映射、线速度与坏帧防护。 | `tests/adapters/inspur.test.ts` (2 tests pass) |
| **WP2.2** | [`apps/device-edge/SPEC_测径仪信号与算法换算规范.md`](../../apps/device-edge/SPEC_测径仪信号与算法换算规范.md)<br>[`apps/device-edge/opmac-driver.ts`](../../apps/device-edge/opmac-driver.ts) | 锁定共久/Opmac 双轴 RS-485 Modbus RTU 寄存器、编码器脉冲计米换算（0.0005m/pulse）、双口径（% 与 mm）归一化公式及断线空料检测。 | `tests/edge/opmac.test.ts` (3 tests pass) |
| **WP2.3** | [`contracts/mes/v1/MES-outbound.md`](../../contracts/mes/v1/MES-outbound.md)<br>[`contracts/mes/v1/mes-inspection-report.schema.json`](../../contracts/mes/v1/mes-inspection-report.schema.json)<br>[`apps/platform/modules/m07-mes/client.ts`](../../apps/platform/modules/m07-mes/client.ts) | 编制高压电缆出站质检完工数据包契约、Draft-07 Schema、HMAC-SHA256 签名算法与 ACK 对账客户端。 | `tests/mes/mes-outbound.test.ts` (2 tests pass) |

---

## 三、 验证结果

执行阶段二新增驱动与契约测试套件：
```text
✔ Inspur ISA-TD-3120 Overlap Rate driver parsing (1.0036ms)
✔ Inspur ISA-LJ-2420 Wire Gap driver parsing (0.3189ms)
✔ Opmac diameter gauge driver: normal measurement parsing (1.3533ms)
✔ Opmac diameter gauge driver: anomaly exceeding threshold (0.2195ms)
✔ Opmac diameter gauge driver: empty / beam blocked detection (0.2117ms)
✔ M07 MES Client: signature calculation and successful ACK handshake (20.5057ms)
✔ M07 MES Client: error response handling (0.6637ms)
7 tests passed | 0 failed (384.8ms)
```

结合阶段一锁定的 80 项后端测试，后端全量测试总数达到 **87 项全部通过（100% 绿色）**。
阶段二硬件与外部契约固化完毕，随时可开展**阶段三：现场边缘采集端（Edge Agent）与首台真机接入联调**。
