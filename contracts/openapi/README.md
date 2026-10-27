# 平台HTTP公开契约预留

按模块组织版本化Schema、错误、权限与幂等样例，后续经工作包确认。README不是已可调用接口。

## 设备接入 v1

[device-ingestion.v1.openapi.json](device-ingestion.v1.openapi.json) 为OpenAPI3.1设计，复用 [设备Schema](../devices/v1/device-ingestion.schema.json)，共9个操作。语义和运行验收见 [第15份](../../huiyanzhijian/docs/15_模拟器与真实设备统一接入契约.md)。已静态验证，当前Docker未提供这些API。

PLAN02新增 [设备1.1](device-ingestion.v1.1.openapi.json) 和 [分析任务](analysis-jobs.v1.openapi.json)，均为设计，未上线。
