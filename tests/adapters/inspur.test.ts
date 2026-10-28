import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOverlapRateRegisters,
  parseWireGapRegisters,
  calculateModbusCRC16,
  verifyModbusCRC16,
  buildModbusRTUResponse,
  buildModbusTCPResponse,
  parseModbusRTUFrame,
  parseModbusTCPFrame,
  parseOverlapRateRTUFrame,
  parseOverlapRateTCPFrame,
  parseWireGapRTUFrame,
  parseWireGapTCPFrame,
  compensateLineSpeed,
} from '../../adapters/inspur/inspur-driver';
import { validateMeasurement } from '../edge/schema-validator';

test('Inspur ISA-TD-3120 Overlap Rate driver parsing', () => {
  const meta = {
    deviceId: 'HY-DG-01',
    captureSessionId: 'SESS-20261028',
    dataEnvironment: 'REAL' as const,
  };

  // 正常运行帧：meter=100.25m, tape=20.00mm, overlap=2.50mm, rate=12.50%, PASS, speed=30.0m/min
  const normalRegs = [1, 100, 2500, 2000, 250, 1250, 1, 0, 300];
  const payload = parseOverlapRateRegisters(normalRegs, 1, meta, '2026-10-28T10:00:00.000000Z');

  assert.equal(payload.device_id, 'HY-DG-01');
  assert.equal(payload.data_environment, 'REAL');
  assert.equal(payload.data_status, 'VALID');
  assert.equal(payload.position_m, '100.2500');
  assert.equal(payload.values[0].metric_code, 'SHIELD_OVERLAP_RATE');
  assert.equal(payload.values[0].value, '12.5000');
  assert.equal(payload.values[0].unit, '%');
  assert.equal(payload.values[0].source_quality_result, 'PASS');
  assert.equal(payload.raw_payload?.overlap_rate_pct, 12.5);

  // 校验符合平台 1.0 Measurement Schema
  const valid = validateMeasurement(payload);
  assert.equal(valid, true, JSON.stringify(validateMeasurement.errors));

  // 超限异常帧：overlap=1.00mm, rate=5.00%, FAIL
  const failRegs = [1, 105, 0, 2000, 100, 500, 2, 1, 300];
  const failPayload = parseOverlapRateRegisters(failRegs, 2, meta, '2026-10-28T10:00:01.000000Z');
  assert.equal(failPayload.values[0].value, '5.0000');
  assert.equal(failPayload.values[0].source_quality_result, 'FAIL');
  assert.equal(validateMeasurement(failPayload), true);

  // 空料待机帧：dev_status=0
  const idleRegs = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const idlePayload = parseOverlapRateRegisters(idleRegs, 3, meta, '2026-10-28T10:00:02.000000Z');
  assert.equal(idlePayload.data_status, 'MISSING');
  assert.equal(idlePayload.values[0].value, null);
  assert.equal(idlePayload.values[0].data_status, 'MISSING');
  assert.equal(validateMeasurement(idlePayload), true);
});

test('Inspur ISA-LJ-2420 Wire Gap driver parsing', () => {
  const meta = {
    deviceId: 'HY-JX-01',
    captureSessionId: 'SESS-20261028',
    dataEnvironment: 'REAL' as const,
  };

  // 正常运行帧：pos=50.500m (50500mm), max_gap=1.20mm, mean=1.05mm, pitch=250.0mm, PASS
  const normalRegs = [1, 0, 50500, 120, 105, 2500, 1, 1, 110, 115, 120, 105];
  const payload = parseWireGapRegisters(normalRegs, 10, meta, '2026-10-28T10:00:00.000000Z');

  assert.equal(payload.device_id, 'HY-JX-01');
  assert.equal(payload.data_environment, 'REAL');
  assert.equal(payload.data_status, 'VALID');
  assert.equal(payload.position_m, '50.5000');
  assert.equal(payload.values[0].metric_code, 'WIRE_GAP');
  assert.equal(payload.values[0].value, '1.2000');
  assert.equal(payload.values[0].unit, 'mm');
  assert.equal(payload.values[0].source_quality_result, 'PASS');
  assert.equal(validateMeasurement(payload), true);

  // 超限异常帧：max_gap=4.00mm, FAIL
  const failRegs = [1, 0, 52000, 400, 250, 2500, 2, 2, 400, 200, 180, 150];
  const failPayload = parseWireGapRegisters(failRegs, 11, meta, '2026-10-28T10:00:01.000000Z');
  assert.equal(failPayload.values[0].value, '4.0000');
  assert.equal(failPayload.values[0].source_quality_result, 'FAIL');
  assert.equal(validateMeasurement(failPayload), true);
});

test('Inspur Modbus RTU & TCP binary frame parsing with CRC16 and bad frame interception', () => {
  const meta = {
    deviceId: 'HY-DG-01',
    captureSessionId: 'SESS-RTU',
    dataEnvironment: 'REAL' as const,
  };

  const regs = [1, 120, 5000, 2000, 300, 1500, 1, 0, 300]; // 120.5000m, 15.00% PASS
  // 1. 构建并解析 Modbus RTU 正常帧
  const rtuFrame = buildModbusRTUResponse(1, 0x03, regs);
  assert.equal(verifyModbusCRC16(rtuFrame), true);

  const rtuParsed = parseOverlapRateRTUFrame(rtuFrame, 100, meta);
  assert.equal(rtuParsed.position_m, '120.5000');
  assert.equal(rtuParsed.values[0].value, '15.0000');
  assert.equal(rtuParsed.values[0].source_quality_result, 'PASS');

  // 2. 坏帧拦截：CRC16 校验错误
  const corruptedRtu = Buffer.from(rtuFrame);
  corruptedRtu[corruptedRtu.length - 1] ^= 0xff; // 破坏 CRC 字节
  assert.throws(
    () => parseModbusRTUFrame(corruptedRtu),
    /CRC_CHECK_FAILED/
  );

  // 3. 坏帧拦截：过短帧
  assert.throws(
    () => parseModbusRTUFrame(Buffer.from([0x01, 0x03])),
    /FRAME_TOO_SHORT/
  );

  // 4. 坏帧拦截：从机异常响应 (0x83)
  const excFrame = Buffer.alloc(5);
  excFrame[0] = 0x01;
  excFrame[1] = 0x83; // 异常标志位
  excFrame[2] = 0x02; // 异常码：非法数据地址
  const crcExc = calculateModbusCRC16(excFrame.subarray(0, 3));
  excFrame[3] = crcExc & 0xff;
  excFrame[4] = (crcExc >> 8) & 0xff;
  assert.throws(
    () => parseModbusRTUFrame(excFrame),
    /MODBUS_EXCEPTION/
  );

  // 5. 构建并解析 Modbus TCP 正常帧
  const tcpFrame = buildModbusTCPResponse(1001, 1, 0x03, regs);
  const tcpParsed = parseOverlapRateTCPFrame(tcpFrame, 101, meta);
  assert.equal(tcpParsed.position_m, '120.5000');
  assert.equal(tcpParsed.values[0].value, '15.0000');

  // 6. 坏帧拦截：Modbus TCP Protocol ID 非 0
  const corruptedTcp = Buffer.from(tcpFrame);
  corruptedTcp[3] = 0x01; // Protocol ID != 0
  assert.throws(
    () => parseModbusTCPFrame(corruptedTcp),
    /INVALID_PROTOCOL_ID/
  );
});

test('Inspur line speed compensation calculation', () => {
  // 测试算法：位置 100.0m，线速度 30.0 m/min (即 0.5 m/s)，时延 0.2s，物理安装偏置 0.05m
  // 补偿位移 = 0.5 * 0.2 + 0.05 = 0.15m -> 最终 100.15m
  const comp = compensateLineSpeed(100.0, 30.0, 0.2, 0.05);
  assert.equal(comp.toFixed(4), '100.1500');

  // 测试驱动自动应用线速度补偿
  const meta = {
    deviceId: 'HY-DG-01',
    captureSessionId: 'SESS-COMP',
    dataEnvironment: 'REAL' as const,
    speedCompensationLatencySec: 0.2,
    sensorOffsetM: 0.05,
  };
  const regs = [1, 100, 0, 2000, 250, 1250, 1, 0, 300]; // pos=100.0000m, speed=30.0m/min
  const payload = parseOverlapRateRegisters(regs, 200, meta);
  assert.equal(payload.position_m, '100.1500');
  assert.equal(payload.raw_payload?.compensated_pos_m, 100.15);
  assert.equal(validateMeasurement(payload), true);
});
