# 设备接入1.1位置扩展

设计未实现。新增position_context、ESTIMATED、任务遍次和profile引用、位置段登记及profile只读。完整语义见 [第16份](../../../huiyanzhijian/docs/16_位置关联与区段分析及任务契约.md)，[样例](../../position-analysis/examples/manifest.json)仅静态夹具。

1.0来源键和原摘要保持；旧队列原版本重发。GET profile和assignment以Accept-Schema-Version选择支持的版本；新写请求schema_version=1.1。schema不验证所有跨字段状态和现场能力。
