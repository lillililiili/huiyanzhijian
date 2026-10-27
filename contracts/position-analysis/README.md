# 位置与分析契约设计

详细语义见 [第16份](../../huiyanzhijian/docs/16_位置关联与区段分析及任务契约.md)。设备1.1见 [Schema](../devices/v1.1/device-ingestion.schema.json) 和 [OpenAPI](../openapi/device-ingestion.v1.1.openapi.json)；分析任务见 [Schema](analysis-jobs.schema.json) 和 [OpenAPI](../openapi/analysis-jobs.v1.openapi.json)。

[样例索引](examples/manifest.json)含结构正反例，[区间黄金向量](interval-golden-vectors.json)含8组TEST_ONLY预期。窗口能力、误差数值均为模拟夹具，不代表真实设备。Schema检查不覆盖授权、跨字段、历史版本、集合运算或事务，运行验收见POS/SEG/JOB。

源码尚未实现。设备1.0文件保留不覆盖；新增1.1不能改变重试中的旧来源键与payload。分析请求使用独立schema_version=1.0，不混同设备线协议版本。
