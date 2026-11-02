# ODM01 浪潮 HTTP 接入

两项设备源统一使用用户提供的 HTTP 分页查询格式。源设备返回供应商字段，M08 转为平台接收 1.0；M04 继续负责权限、任务/规则校验、持久化及逐条回执。无需重写前端或原有接收 API。

## 两种宿主，共用实现
- 模拟器：新 DG/JX 样本在 SQLite 同事务保存设备响应和平台出站包。DeviceClient 先通过 HTTP 查询回读设备响应，再用本目录 contract/client 映射和发送。CLI 没有Web服务时开启短生命周期的只读回环 HTTP 源；Web服务使用4196的设备端点。不会在查询失败时降级直接推送。
- 独立 M08 采集器：`node adapters/inspur/http/collector.cjs <配置文件>`。一次拉取配置的闭合时间窗，SQLite持久化出站包，逐条回执后改状态。再次运行同一配置/队列可补传和补取迟到样本。按固定任务/lineId建立一个队列，换任务使用新队列；不可把全部设备历史套到当前任务。当前是有界采集命令，未交付常驻调度和配置网页。

真实配置尚未齐全，示例中的 `confirmed:false` 会阻止 REAL 启动。确认后填写 `confirmationReference`，明确接口方式、地址、路径、时间字段及偏移、比例和单位、鉴权环境变量，再做HW验证。不要仅为绕过检查修改 confirmed。

```json
{
  "metric": "SHIELD_OVERLAP_RATE",
  "environment": "REAL",
  "confirmed": false,
  "confirmationReference": "",
  "baseUrl": "http://DEVICE-HOST:PORT",
  "method": "POST",
  "path": "/sys/copperStrip/getRealTimeData",
  "percentScale": "UNKNOWN",
  "gapUnit": "UNKNOWN",
  "timezoneOffsetMinutes": 480,
  "sampleTimeField": "dataCreateTime",
  "headerEnv": {},
  "platformUrl": "http://127.0.0.1:4192",
  "platformTokenEnv": "DEVICE_TOKEN",
  "deviceId": "待填写设备ID",
  "lineId": "待填写供应商生产编号",
  "expectedTaskId": "待填写当前平台任务ID",
  "startTime": "2026-11-02 00:00:00",
  "endTime": "2026-11-02 00:01:00",
  "limit": 100,
  "queueFile": "runtime/inspur/device-task.sqlite"
}
```

间隙配置 metric=`WIRE_GAP`，path原件建议值`/sys/copperStrip/getGapRealTimeData`待确认，采集器固定查询`dataType:GAP`。PITCH只保留接口类型识别，不作为间隙值；模拟器当前不生成节距数据，查询PITCH为空。POST/时区/时间字段仅示例，非已批准现场参数。

`headerEnv` 将请求头名映射到环境变量名，例如 `{"Authorization":"INSPUR_AUTHORIZATION"}`，环境变量值包含现场确认的完整头值；不把密钥写在配置/证据。认证可以为空仅当设备协议明确无鉴权。真实设备来源与模拟设备使用不同平台凭据和设备档案。

## 模拟器查询
正常查询请求体严格为 `lineId,startTime,endTime,limit,page`；间隙追加`dataType`。page从1开始，limit为1～500，日期为`yyyy-MM-dd HH:mm:ss`，count是完整筛选总数。响应为`code,msg,data,success,timestamp,count`。固定时间窗内按采样毫秒、记录ID稳定排序。

模拟约定（TEST_ONLY）：POST、UTC+08:00、dataCreateTime为采样毫秒、buildPercent百分数、buildWidth毫米。模拟器共用一个地址承载多台设备，因此附加`X-Sim-Device-Id`与`Authorization: Bearer <SIM_VENDOR_TOKEN>`头；不扩展厂家JSON。令牌只用于模拟器设备源，默认启动时随机生成供本机子进程使用；外部M08需要显式配置SIM_VENDOR_TOKEN。真实设备各自地址/鉴权以现场确认配置替换，不发送模拟专用头。

来源lineId在模拟中等于本次capture_session_id，并在本地context绑定原task/binding；它不是盘号/工单号。生产lineId由配置显式映射，绝不按同名推断。

## 字段、有效性和限制
- 搭盖率只取buildPercent；null不从buildWidth/stripWidth补算。比例UNKNOWN则保留原文、INVALID/null；比例PERCENT不缩放，FRACTION精确移小数点两位。
- GAP只取buildWidth；单位UNKNOWN则INVALID/null。mm/cm/m显式转成平台mm，超出平台14位整数/10位小数能力标INVALID，不四舍五入到边界。
- dataCreateTime和dataDate+dataTime是可选明确时间来源；createTime不代替采样时间。全部供应商时间、原始编号、图片路径、控制状态和公差均保留于vendor_record_json；不把控制状态解释为质量结论，不把公差改为平台规则。
- 无来源质量字段，因此source_quality_result固定NOT_EVALUATED；由任务冻结规则判定。模拟器预设检出对比使用本地simulation_result，不能冒充设备上报PASS/FAIL。
- 必填字段缺失/类型错误保留原文并标INVALID（缺ID或不可定位时间无法构造合法测点时明确拒绝，源队列保留）。缺失位置不补零；存在seat但没有外部位置段时以捕获会话作为技术段ID，平台位置资格仍为未验证，不代表连续覆盖或校准通过。模拟故障注入会故意输出null必填量，用于验证拒绝/无效处理，正常响应不这样生成。
- 模拟诊断数值场景使用20mm虚拟铜带；规格场景用当前规格几何值。coreSpeed/angle/coreDiameter/controlStatus的0仅是模拟占位，未宣称真实测量；不参与判定。没有图片输出时buildPicPath为空，不伪造现场实拍。
- HTTP 200还必须code=200且success=true；count/分页完整性、重复ID、同ID异原文均校验。数据集分页途中改变会失败并保留队列，下次重试整个固定窗口。无法从文档保证供应商排序/迟到窗口，HW须补测；尚未作高吞吐容量验收。
- 原文通过JSON文本保留（数值为供应商JSON数值的解析结果），平台raw内避免小数JSON Number；未做供应商原始HTTP字节归档。HTTP解析前会拒绝将被JSON.parse静默舍入的数字；此类报文留在源端等待更正/无损解析适配，不继续产生可能错误的判定。
- 同设备不同时运行模拟器内置适配和独立采集器读取同一份样本；两种宿主各管理自身捕获会话。源ID稳定性、清库后ID重用等仍需真机确认。

## 迁移与上线
017仅给已有两项设备追加原文格式注册，bootstrap同时覆盖新安装；不改历史原文、任务快照或不圆度。先备份、正常迁移，再更新模拟器镜像；只构建未部署。现存迁移校验漂移必须先人工核对，禁止跳过校验/覆盖旧checksum。
模拟器Dockerfile已包含共用M08目录；部署仍保留现有数据卷。回退旧模拟器后历史新格式仍能查询；新队列的设备源/重试需要ODM01版本，不将新样本反写成旧格式。
