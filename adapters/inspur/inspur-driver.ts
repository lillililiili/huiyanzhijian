/**
 * 浪潮检测设备原始 Modbus RTU/TCP 报文与寄存器到平台标准化测点（Device Ingestion v1.0）转换器
 * 遵循 SPEC_浪潮设备协议与寄存器映射.md 规范
 */

export interface DeviceMetadata {
  deviceId: string;
  captureSessionId: string;
  dataEnvironment: 'REAL' | 'SIMULATED';
  recipeVersionId?: string | null;
  taskId?: string | null;
  bindingId?: string | null;
  bindingVersion?: string | null;
  positionSegmentId?: string | null;
  rawSchemaVersion?: string;
  speedCompensationLatencySec?: number; // 线速度延迟补偿时间（秒）
  sensorOffsetM?: number; // 传感器物理安装基准距离偏移（米）
}

export interface IngestionMeasurementValue {
  metric_code: 'SHIELD_OVERLAP_RATE' | 'WIRE_GAP' | 'OVALITY';
  value: string | null;
  unit: string;
  data_status: 'VALID' | 'INVALID' | 'MISSING';
  source_quality_result: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  method_id?: string | null;
  window: {
    kind: 'INSTANT' | 'TIME' | 'POSITION' | 'DEVICE_DEFINED';
    definition_id: string | null;
    start: string | null;
    end: string | null;
    position_from_m: string | null;
    position_to_m: string | null;
  };
  reason_code?: string | null;
}

export interface StandardIngestionPayload {
  record_id: string;
  device_id: string;
  capture_session_id: string;
  capture_sequence: string;
  source_record_id: string | null;
  source_session_id: string | null;
  source_sequence: string | null;
  sample_kind: 'NEW_SAMPLE' | 'READ_SNAPSHOT';
  task_id: string | null;
  binding_id: string | null;
  binding_version: string | null;
  sample_time: string;
  time_source: 'DEVICE' | 'ADAPTER' | 'SIMULATOR';
  position_m: string | null;
  position_quality: 'KNOWN' | 'UNKNOWN' | 'INVALID';
  position_segment_id: string | null;
  source_type: 'DEVICE' | 'DERIVED';
  data_environment: 'REAL' | 'SIMULATED';
  data_status: 'VALID' | 'INVALID' | 'MISSING';
  recipe_version_id: string | null;
  values: IngestionMeasurementValue[];
  raw: {
    schema_version: string;
    data: Record<string, unknown>;
  };
  evidence_refs: string[];
  raw_payload?: Record<string, unknown>;
}

/**
 * 计算 Modbus CRC16（多项式 0xA001，初始值 0xFFFF）
 */
export function calculateModbusCRC16(buffer: Uint8Array | Buffer): number {
  let crc = 0xffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 1) !== 0) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc = crc >> 1;
      }
    }
  }
  return crc & 0xffff;
}

/**
 * 校验 Modbus RTU 帧末尾两个字节的 CRC16
 */
export function verifyModbusCRC16(frame: Uint8Array | Buffer): boolean {
  if (!frame || frame.length < 4) return false;
  const data = frame.subarray(0, frame.length - 2);
  const expectedCrc = calculateModbusCRC16(data);
  const actualCrc = frame[frame.length - 2] | (frame[frame.length - 1] << 8); // RTU: 低字节在前，高字节在后
  return expectedCrc === actualCrc;
}

/**
 * 构建标准 Modbus RTU 响应帧（含从机地址、功能码、字节计数、寄存器数据与 CRC16）
 */
export function buildModbusRTUResponse(slaveId: number, funcCode: number, regs: number[]): Buffer {
  const byteCount = regs.length * 2;
  const buf = Buffer.alloc(3 + byteCount + 2);
  buf.writeUInt8(slaveId, 0);
  buf.writeUInt8(funcCode, 1);
  buf.writeUInt8(byteCount, 2);
  for (let i = 0; i < regs.length; i++) {
    buf.writeUInt16BE(regs[i] & 0xffff, 3 + i * 2);
  }
  const crc = calculateModbusCRC16(buf.subarray(0, 3 + byteCount));
  buf.writeUInt8(crc & 0xff, 3 + byteCount);
  buf.writeUInt8((crc >> 8) & 0xff, 3 + byteCount + 1);
  return buf;
}

/**
 * 构建标准 Modbus TCP 响应帧（含 MBAP 头、从机单元、功能码、字节计数与寄存器数据）
 */
export function buildModbusTCPResponse(txId: number, unitId: number, funcCode: number, regs: number[]): Buffer {
  const byteCount = regs.length * 2;
  const pduLen = 2 + 1 + byteCount; // unitId(1) + funcCode(1) + byteCount(1) + data(N)
  const buf = Buffer.alloc(6 + pduLen);
  buf.writeUInt16BE(txId, 0);
  buf.writeUInt16BE(0, 2); // Protocol ID = 0 (Modbus)
  buf.writeUInt16BE(pduLen, 4);
  buf.writeUInt8(unitId, 6);
  buf.writeUInt8(funcCode, 7);
  buf.writeUInt8(byteCount, 8);
  for (let i = 0; i < regs.length; i++) {
    buf.writeUInt16BE(regs[i] & 0xffff, 9 + i * 2);
  }
  return buf;
}

/**
 * 解析并拦截 Modbus RTU 响应坏帧
 */
export function parseModbusRTUFrame(
  frame: Uint8Array | Buffer,
  expectedSlaveId?: number
): { slaveId: number; functionCode: number; registers: number[] } {
  if (!frame || frame.length < 5) {
    throw new Error(`FRAME_TOO_SHORT: Expected at least 5 bytes, got ${frame?.length || 0}`);
  }

  // 1. CRC16 校验
  if (!verifyModbusCRC16(frame)) {
    throw new Error('CRC_CHECK_FAILED: Modbus RTU CRC16 checksum mismatch');
  }

  const slaveId = frame[0];
  if (expectedSlaveId !== undefined && slaveId !== expectedSlaveId) {
    throw new Error(`SLAVE_ID_MISMATCH: Expected ${expectedSlaveId}, got ${slaveId}`);
  }

  const funcCode = frame[1];
  // 2. 异常功能码拦截（0x80 以上表示从机异常应答）
  if ((funcCode & 0x80) !== 0) {
    const excCode = frame[2];
    throw new Error(`MODBUS_EXCEPTION: Function code 0x${funcCode.toString(16)}, Exception code 0x${excCode.toString(16)}`);
  }

  const byteCount = frame[2];
  if (byteCount !== frame.length - 5) {
    throw new Error(`BYTE_COUNT_MISMATCH: Declared ${byteCount} bytes, actual payload is ${frame.length - 5}`);
  }

  const regCount = Math.floor(byteCount / 2);
  const registers: number[] = [];
  for (let i = 0; i < regCount; i++) {
    registers.push((frame[3 + i * 2] << 8) | frame[3 + i * 2 + 1]);
  }

  return { slaveId, functionCode: funcCode, registers };
}

/**
 * 解析并拦截 Modbus TCP 响应坏帧
 */
export function parseModbusTCPFrame(
  frame: Uint8Array | Buffer,
  expectedUnitId?: number
): { transactionId: number; unitId: number; functionCode: number; registers: number[] } {
  if (!frame || frame.length < 9) {
    throw new Error(`FRAME_TOO_SHORT: Expected at least 9 bytes for Modbus TCP, got ${frame?.length || 0}`);
  }

  const txId = (frame[0] << 8) | frame[1];
  const protocolId = (frame[2] << 8) | frame[3];
  if (protocolId !== 0) {
    throw new Error(`INVALID_PROTOCOL_ID: Expected 0 for Modbus TCP, got ${protocolId}`);
  }

  const lengthField = (frame[4] << 8) | frame[5];
  if (lengthField !== frame.length - 6) {
    throw new Error(`MBAP_LENGTH_MISMATCH: Header indicated ${lengthField} bytes, actual is ${frame.length - 6}`);
  }

  const unitId = frame[6];
  if (expectedUnitId !== undefined && unitId !== expectedUnitId) {
    throw new Error(`UNIT_ID_MISMATCH: Expected ${expectedUnitId}, got ${unitId}`);
  }

  const funcCode = frame[7];
  if ((funcCode & 0x80) !== 0) {
    const excCode = frame[8];
    throw new Error(`MODBUS_EXCEPTION: Function code 0x${funcCode.toString(16)}, Exception code 0x${excCode.toString(16)}`);
  }

  const byteCount = frame[8];
  if (byteCount !== frame.length - 9) {
    throw new Error(`BYTE_COUNT_MISMATCH: Declared ${byteCount} bytes, actual is ${frame.length - 9}`);
  }

  const regCount = Math.floor(byteCount / 2);
  const registers: number[] = [];
  for (let i = 0; i < regCount; i++) {
    registers.push((frame[9 + i * 2] << 8) | frame[9 + i * 2 + 1]);
  }

  return { transactionId: txId, unitId, functionCode: funcCode, registers };
}

/**
 * 线速度延迟与位置补偿计算
 * @param rawPosM 原始位置（米）
 * @param lineSpeedMPerMin 实时产线线速度（米/分钟）
 * @param latencySec 相机曝光、AI推理及通讯时延（秒）
 * @param sensorOffsetM 测点到基准点物理安装间距偏移（米）
 */
export function compensateLineSpeed(
  rawPosM: number,
  lineSpeedMPerMin: number,
  latencySec: number = 0,
  sensorOffsetM: number = 0
): number {
  const speedMPerSec = lineSpeedMPerMin / 60;
  const speedOffset = speedMPerSec * latencySec;
  return rawPosM + speedOffset + sensorOffsetM;
}

/**
 * 解析金属屏蔽搭盖率设备（ISA-TD-3120）Modbus 保持寄存器 (40001~40010, 共10个字)
 */
export function parseOverlapRateRegisters(
  regs: number[],
  seq: number,
  meta: DeviceMetadata,
  sampleTime: string = new Date().toISOString()
): StandardIngestionPayload {
  if (!regs || regs.length < 9) {
    throw new Error(`Invalid register buffer length for ISA-TD-3120: expected >= 9, got ${regs?.length}`);
  }

  const devStatus = regs[0];
  const meterInt = regs[1];
  const meterDec = regs[2];
  const tapeWidthRaw = regs[3];
  const overlapWidthRaw = regs[4];
  const overlapRateRaw = regs[5];
  const qualityState = regs[6];
  const defectFlags = regs[7];
  const lineSpeedRaw = regs[8];

  const rawPosM = meterInt + meterDec / 10000;
  const lineSpeedMPerMin = lineSpeedRaw / 10;

  // 执行线速度补偿（若元数据提供了时延或物理偏移配置）
  let finalPosM = rawPosM;
  if (meta.speedCompensationLatencySec || meta.sensorOffsetM) {
    finalPosM = compensateLineSpeed(
      rawPosM,
      lineSpeedMPerMin,
      meta.speedCompensationLatencySec || 0,
      meta.sensorOffsetM || 0
    );
  }

  // 坏数据/空料保护：devStatus === 0 或数值异常
  const isValid = devStatus === 1 && tapeWidthRaw > 0 && overlapWidthRaw >= 0 && tapeWidthRaw !== 0xffff;

  let qualityResult: 'PASS' | 'FAIL' | 'NOT_EVALUATED' = 'NOT_EVALUATED';
  if (isValid) {
    qualityResult = qualityState === 1 ? 'PASS' : qualityState === 2 ? 'FAIL' : 'NOT_EVALUATED';
  }

  const overlapRateVal = isValid ? (overlapRateRaw / 100).toFixed(4) : null;
  const posMStr = isValid ? finalPosM.toFixed(4) : null;
  const segmentId = isValid ? (meta.positionSegmentId || 'SEG-01') : null;

  const rawData: Record<string, unknown> = {
    dev_status: devStatus,
    tape_width_mm: Number((tapeWidthRaw / 100).toFixed(2)),
    overlap_width_mm: Number((overlapWidthRaw / 100).toFixed(2)),
    overlap_rate_pct: Number((overlapRateRaw / 100).toFixed(2)),
    defect_flags: defectFlags,
    line_speed_m_min: Number(lineSpeedMPerMin.toFixed(1)),
    raw_pos_m: Number(rawPosM.toFixed(4)),
    compensated_pos_m: Number(finalPosM.toFixed(4)),
  };

  const payload: StandardIngestionPayload = {
    record_id: `${meta.deviceId}-${meta.captureSessionId}-${seq}`,
    device_id: meta.deviceId,
    capture_session_id: meta.captureSessionId,
    capture_sequence: String(seq),
    source_record_id: null,
    source_session_id: null,
    source_sequence: null,
    sample_kind: 'NEW_SAMPLE',
    task_id: meta.taskId || null,
    binding_id: meta.bindingId || null,
    binding_version: meta.bindingVersion || null,
    sample_time: sampleTime,
    time_source: 'DEVICE',
    position_m: posMStr,
    position_quality: isValid ? 'KNOWN' : 'UNKNOWN',
    position_segment_id: segmentId,
    source_type: 'DEVICE',
    data_environment: meta.dataEnvironment,
    data_status: isValid ? 'VALID' : devStatus === 0 ? 'MISSING' : 'INVALID',
    recipe_version_id: meta.recipeVersionId || null,
    values: [
      {
        metric_code: 'SHIELD_OVERLAP_RATE',
        value: overlapRateVal,
        unit: '%',
        data_status: isValid ? 'VALID' : 'MISSING',
        source_quality_result: qualityResult,
        method_id: 'DG-V1.0',
        window: {
          kind: 'INSTANT',
          definition_id: null,
          start: null,
          end: null,
          position_from_m: null,
          position_to_m: null,
        },
        reason_code: isValid ? null : devStatus === 0 ? 'DEVICE_STANDBY_IDLE' : 'INVALID_RAW_VALUE',
      },
    ],
    raw: {
      schema_version: meta.rawSchemaVersion || 'overlap-sim.v1',
      data: rawData,
    },
    evidence_refs: [],
  };

  // 保留非枚举 raw_payload 属性，兼容原有业务访问
  Object.defineProperty(payload, 'raw_payload', {
    value: rawData,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return payload;
}

/**
 * 解析铜丝间隙/笼绞检测设备（ISA-LJ-2420/3420）Modbus 保持寄存器 (40101~40112, 共12个字)
 */
export function parseWireGapRegisters(
  regs: number[],
  seq: number,
  meta: DeviceMetadata,
  sampleTime: string = new Date().toISOString()
): StandardIngestionPayload {
  if (!regs || regs.length < 8) {
    throw new Error(`Invalid register buffer length for ISA-LJ: expected >= 8, got ${regs?.length}`);
  }

  const devStatus = regs[0];
  const posHigh = regs[1];
  const posLow = regs[2];
  const maxGapRaw = regs[3];
  const meanGapRaw = regs[4];
  const pitchRaw = regs[5];
  const qualityState = regs[6];
  const defectType = regs[7];

  const posMm = (posHigh << 16) + posLow;
  const rawPosM = posMm / 1000;

  // 坏数据/空料保护
  const isValid = devStatus === 1 && maxGapRaw >= 0 && maxGapRaw !== 0xffff;

  let qualityResult: 'PASS' | 'FAIL' | 'NOT_EVALUATED' = 'NOT_EVALUATED';
  if (isValid) {
    qualityResult = qualityState === 1 ? 'PASS' : (qualityState === 2 || qualityState === 3) ? 'FAIL' : 'NOT_EVALUATED';
  }

  const maxGapVal = isValid ? (maxGapRaw / 100).toFixed(4) : null;
  const posMStr = isValid ? rawPosM.toFixed(4) : null;
  const segmentId = isValid ? (meta.positionSegmentId || 'SEG-01') : null;

  const rawData: Record<string, unknown> = {
    dev_status: devStatus,
    pos_mm: posMm,
    max_wire_gap_mm: Number((maxGapRaw / 100).toFixed(2)),
    mean_wire_gap_mm: Number((meanGapRaw / 100).toFixed(2)),
    pitch_length_mm: Number((pitchRaw / 10).toFixed(1)),
    defect_type: defectType,
    gap_points: regs.slice(8, 12).map((r) => Number((r / 100).toFixed(2))),
  };

  const payload: StandardIngestionPayload = {
    record_id: `${meta.deviceId}-${meta.captureSessionId}-${seq}`,
    device_id: meta.deviceId,
    capture_session_id: meta.captureSessionId,
    capture_sequence: String(seq),
    source_record_id: null,
    source_session_id: null,
    source_sequence: null,
    sample_kind: 'NEW_SAMPLE',
    task_id: meta.taskId || null,
    binding_id: meta.bindingId || null,
    binding_version: meta.bindingVersion || null,
    sample_time: sampleTime,
    time_source: 'DEVICE',
    position_m: posMStr,
    position_quality: isValid ? 'KNOWN' : 'UNKNOWN',
    position_segment_id: segmentId,
    source_type: 'DEVICE',
    data_environment: meta.dataEnvironment,
    data_status: isValid ? 'VALID' : devStatus === 0 ? 'MISSING' : 'INVALID',
    recipe_version_id: meta.recipeVersionId || null,
    values: [
      {
        metric_code: 'WIRE_GAP',
        value: maxGapVal,
        unit: 'mm',
        data_status: isValid ? 'VALID' : 'MISSING',
        source_quality_result: qualityResult,
        method_id: 'JX-V1.0',
        window: {
          kind: 'INSTANT',
          definition_id: null,
          start: null,
          end: null,
          position_from_m: null,
          position_to_m: null,
        },
        reason_code: isValid ? null : 'INVALID_WIRE_GAP_DATA',
      },
    ],
    raw: {
      schema_version: meta.rawSchemaVersion || 'wire-gap-sim.v1',
      data: rawData,
    },
    evidence_refs: [],
  };

  // 保留非枚举 raw_payload 属性，兼容原有业务访问
  Object.defineProperty(payload, 'raw_payload', {
    value: rawData,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return payload;
}

/**
 * 直接解析搭盖率设备 Modbus RTU 原始二进制帧并转化为标准测点
 */
export function parseOverlapRateRTUFrame(
  frame: Uint8Array | Buffer,
  seq: number,
  meta: DeviceMetadata,
  sampleTime?: string
): StandardIngestionPayload {
  const { registers } = parseModbusRTUFrame(frame);
  return parseOverlapRateRegisters(registers, seq, meta, sampleTime);
}

/**
 * 直接解析搭盖率设备 Modbus TCP 原始二进制帧并转化为标准测点
 */
export function parseOverlapRateTCPFrame(
  frame: Uint8Array | Buffer,
  seq: number,
  meta: DeviceMetadata,
  sampleTime?: string
): StandardIngestionPayload {
  const { registers } = parseModbusTCPFrame(frame);
  return parseOverlapRateRegisters(registers, seq, meta, sampleTime);
}

/**
 * 直接解析铜丝间隙设备 Modbus RTU 原始二进制帧并转化为标准测点
 */
export function parseWireGapRTUFrame(
  frame: Uint8Array | Buffer,
  seq: number,
  meta: DeviceMetadata,
  sampleTime?: string
): StandardIngestionPayload {
  const { registers } = parseModbusRTUFrame(frame);
  return parseWireGapRegisters(registers, seq, meta, sampleTime);
}

/**
 * 直接解析铜丝间隙设备 Modbus TCP 原始二进制帧并转化为标准测点
 */
export function parseWireGapTCPFrame(
  frame: Uint8Array | Buffer,
  seq: number,
  meta: DeviceMetadata,
  sampleTime?: string
): StandardIngestionPayload {
  const { registers } = parseModbusTCPFrame(frame);
  return parseWireGapRegisters(registers, seq, meta, sampleTime);
}
