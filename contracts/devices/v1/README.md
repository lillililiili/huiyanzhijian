# 设备和模拟器接入契约 v1

设计版本1.0.0-draft.1；wire schema_version为1.0。所有端点未实现。

按顺序读取：

1. [正式语义及32项验收](../../../huiyanzhijian/docs/15_模拟器与真实设备统一接入契约.md)。
2. [OpenAPI](../../openapi/device-ingestion.v1.openapi.json) 和 [JSON Schema](device-ingestion.schema.json)。
3. [样例清单](examples/manifest.json)：17份结构正例、8份格式反例。快照摘要、文件摘要为明确占位，不作为运行黄金向量。

响应外层包含code/message/request_id/data。批量接口须按正文两阶段校验：包络及整包权限预检，再逐条校验及事务，不能因其中一条结构错误拒掉整包。Schema合法不代表授权、历史绑定、物理范围和幂等成立。

模拟器和真机适配分别实现；不得导入平台业务代码、直写业务库或浏览器存储。协议与业务原始资料保持独立，真实raw版本需供应商依据。

静态复现：项目根使用Node运行 `临时文件夹/接入契约_ING01/validate-contract.cjs`，隔离工具版本在同目录validator-node/package-lock.json。生成来源为build_contract_artifacts.py；手工修订机器定义时同步生成脚本，防止再次生成覆盖修改。
