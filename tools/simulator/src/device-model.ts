// Detector receives a local observation, never the cable's defect list.
import {type Geometry,type Metric,metrics,keys,named,fixed,insist} from './cable-model';
export type Detector={name:string;device_id:string;metric:Metric;step_m:string;speed_m_min:string;lower:string;upper:string};

/**
 * 标准 Modbus-RTU CRC16 校验计算（多项式 0xA001，初值 0xFFFF，低字节在前、高字节在后）
 * 对齐《OpmacBL说明书2026-06.pdf》8.5 节与《170A-2D双向测径仪补充说明.pdf》第 1 页帧格式
 */
export function crc16ModbusBytes(bytes: number[]): [number, number] {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >>> 1) ^ 0xa001;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return [crc & 0xff, (crc >>> 8) & 0xff];
}

export function formatHexFrame(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function buildModbusRtuFrame(payloadWithoutCrc: number[]): string {
  const [crcLo, crcHi] = crc16ModbusBytes(payloadWithoutCrc);
  return formatHexFrame([...payloadWithoutCrc, crcLo, crcHi]);
}

function toUint16Bytes(val: number): [number, number] {
  const u16 = ((Math.round(val) % 65536) + 65536) % 65536;
  return [(u16 >>> 8) & 0xff, u16 & 0xff];
}

export interface Opmac170A2DObservationParams {
  diameterXMm: number;
  diameterYMm: number;
  dataStatus: 'VALID' | 'MISSING' | 'INVALID';
  posX?: number;
  posY?: number;
  referenceDiameterMm?: number;
  abnormal?: boolean;
}

/**
 * 依据《OpmacBL说明书2026-06.pdf》及《170A-2D双向测径仪补充说明.pdf》
 * 生成双向激光测径仪（主机 X 轴 0°—180°、从机 Y 轴 90°—270°）两点距离测量、
 * 椭圆长短轴推导值及 Modbus-RTU (200H~205H / 3EH~46H) 寄存器与报文帧。
 */
export function buildOpmac170A2DObservation(params: Opmac170A2DObservationParams): Record<string, unknown> {
  const {
    diameterXMm,
    diameterYMm,
    dataStatus,
    posX = 8,
    posY = -14,
    referenceDiameterMm = 40.0,
    abnormal = false,
  } = params;

  // 170A-2D 补充说明 第 1 页：主机地址 0x01，功能码 0x03，起始地址 0x0200，读取 6 个寄存器 -> 01 03 02 00 00 06 C4 70
  const tx170A = buildModbusRtuFrame([0x01, 0x03, 0x02, 0x00, 0x00, 0x06]);
  // OpmacBL 说明书 8.5 节表 8-7：起始地址 0x0041 (40066)，连续读取 5 个寄存器 (41H~45H：平均直径、X直径、Y直径、X位置、Y位置)
  const txOpmacBL = buildModbusRtuFrame([0x01, 0x03, 0x00, 0x41, 0x00, 0x05]);

  if (dataStatus !== 'VALID') {
    // 170A-2D 状态字 0x0200 (40513):
    // Bit3~0 = 2 (双轴测径仪)
    // MISSING (无被测物 Err-6/Err-7, ¯_¯_¯): Bit14(Y无被测物)=1, Bit10(X无被测物)=1, Bit6(整机无被测物)=1 -> 0x4442
    // INVALID (错误 Err-3/Err-4, 光路遮挡或多根被测物): Bit13(Y错误)=1, Bit9(X错误)=1, Bit5(整机错误)=1 -> 0x2222
    const statusWordNum = dataStatus === 'MISSING' ? 0x4442 : 0x2222;
    const statusWordHex = '0x' + statusWordNum.toString(16).toUpperCase().padStart(4, '0');
    // OpmacBL 3EH (40063) 运行状态字：第一字节 bit7=故障, bit6=无被测物, bit5=有错误；第二字节错误码 (6=ERR-6, 3=ERR-3)
    const runStatus3ENum = dataStatus === 'MISSING' ? 0x4006 : 0x2003;
    const runStatus3EHex = '0x' + runStatus3ENum.toString(16).toUpperCase().padStart(4, '0');
    const panelSymbol = dataStatus === 'MISSING' ? 'Err-6 / Err-7 (¯_¯_¯)' : 'Err-3 / Err-4';

    const rx170A = buildModbusRtuFrame([
      0x01, 0x03, 0x0c,
      ...toUint16Bytes(statusWordNum),
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
    ]);
    const rxOpmacBL = buildModbusRtuFrame([
      0x01, 0x03, 0x0a,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
    ]);

    return {
      instrument_model: 'Opmac-170AL2-2D',
      protocol: 'MODBUS_RTU',
      comm_settings: 'ADD1=1, BAUD1=9600, CH-T1=2 (Modbus-RTU 8N1); Master CH-T=13 / Slave ADD=2, BAUD=115200, CH-T=0',
      panel_display_symbol: panelSymbol,
      diameter_x_mm: '0',
      diameter_y_mm: '0',
      axis1_position_pct: 0,
      axis2_position_pct: 0,
      major_axis_mm: '0',
      minor_axis_mm: '0',
      average_diameter_mm: '0',
      reference_diameter_mm: referenceDiameterMm.toFixed(6),
      deviation_avg_mm: '0',
      deviation_x_mm: '0',
      deviation_y_mm: '0',
      ovality_difference_mm: '0',
      centripetal_ratio_f: '0',
      axis_ratio_f: '0',
      ovality_pct: '0',
      axis_pairs: [
        {
          group_no: 1,
          axis_code: 'X',
          role: 'MASTER_AXIS_1',
          angle_a_deg: 0,
          angle_b_deg: 180,
          angle_label: '0°—180°',
          diameter_mm: '0',
          position_offset: 0,
          axis_state: dataStatus === 'MISSING' ? 'Err-6 (X轴未检测到被测物)' : 'Err-3 (X轴无光或多根被测物)',
        },
        {
          group_no: 2,
          axis_code: 'Y',
          role: 'SLAVE_AXIS_2',
          angle_a_deg: 90,
          angle_b_deg: 270,
          angle_label: '90°—270°',
          diameter_mm: '0',
          position_offset: 0,
          axis_state: dataStatus === 'MISSING' ? 'Err-7 (Y轴未检测到被测物)' : 'Err-4 (Y轴无光或多根被测物)',
        },
      ],
      registers: {
        '0x0200_status_word': statusWordHex,
        '0x0201_avg_diameter_001mm': 0,
        '0x0202_axis1_diameter_001mm': 0,
        '0x0203_axis1_position': 0,
        '0x0204_axis2_diameter_001mm': 0,
        '0x0205_axis2_position': 0,
        '0x003E_run_status': runStatus3EHex,
        '0x0041_avg_diameter_001mm': 0,
        '0x0042_x_diameter_001mm': 0,
        '0x0043_y_diameter_001mm': 0,
        '0x0044_x_position': 0,
        '0x0045_y_position': 0,
        '0x0046_pre_e_001mm': Math.round(referenceDiameterMm * 100),
        tx_frame_hex: tx170A,
        rx_frame_hex: rx170A,
        opmac_bl_tx_hex: txOpmacBL,
        opmac_bl_rx_hex: rxOpmacBL,
      },
    };
  }

  const x = diameterXMm;
  const y = diameterYMm;
  const major = Math.max(x, y);
  const minor = Math.min(x, y);
  const avg = (x + y) / 2;
  const diff = Math.abs(x - y);
  // OpmacBL 说明书第 10 页 DP2-S=2：椭圆向心率 f = 短轴 / 长轴
  const centripetalF = major > 0 ? minor / major : 1;
  // 长短轴比 a / b
  const axisRatio = minor > 0 ? major / minor : 1;
  // 平台百分比不圆度 (%) = (长轴 - 短轴) / 平均直径 * 100% = 2 * |X - Y| / (X + Y) * 100%
  const ovalityPct = avg > 0 ? (diff / avg) * 100 : 0;

  // OpmacBL 说明书第 12 页注 1：偏差值 = 实测数值 - 参考直径值
  const devAvg = avg - referenceDiameterMm;
  const devX = x - referenceDiameterMm;
  const devY = y - referenceDiameterMm;

  const reg200 = 0x0002; // Bit3~0 = 2 (双轴测径仪)，整机及X/Y轴状态全 0 正常
  const reg201 = Math.round(avg * 100);
  const reg202 = Math.round(x * 100);
  const reg203 = Math.max(-99, Math.min(99, Math.round(posX)));
  const reg204 = Math.round(y * 100);
  const reg205 = Math.max(-99, Math.min(99, Math.round(posY)));

  const rx170A = buildModbusRtuFrame([
    0x01, 0x03, 0x0c,
    ...toUint16Bytes(reg200),
    ...toUint16Bytes(reg201),
    ...toUint16Bytes(reg202),
    ...toUint16Bytes(reg203),
    ...toUint16Bytes(reg204),
    ...toUint16Bytes(reg205),
  ]);

  const rxOpmacBL = buildModbusRtuFrame([
    0x01, 0x03, 0x0a,
    ...toUint16Bytes(reg201),
    ...toUint16Bytes(reg202),
    ...toUint16Bytes(reg204),
    ...toUint16Bytes(reg203),
    ...toUint16Bytes(reg205),
  ]);

  return {
    instrument_model: 'Opmac-170AL2-2D',
    protocol: 'MODBUS_RTU',
    comm_settings: 'ADD1=1, BAUD1=9600, CH-T1=2 (Modbus-RTU 8N1); Master CH-T=13 / Slave ADD=2, BAUD=115200, CH-T=0',
    panel_display_symbol: abnormal ? 'Alm+' : 'Norm',
    diameter_x_mm: x.toFixed(6),
    diameter_y_mm: y.toFixed(6),
    axis1_position_pct: reg203,
    axis2_position_pct: reg205,
    major_axis_mm: major.toFixed(6),
    minor_axis_mm: minor.toFixed(6),
    average_diameter_mm: avg.toFixed(6),
    reference_diameter_mm: referenceDiameterMm.toFixed(6),
    deviation_avg_mm: devAvg.toFixed(6),
    deviation_x_mm: devX.toFixed(6),
    deviation_y_mm: devY.toFixed(6),
    ovality_difference_mm: diff.toFixed(6),
    centripetal_ratio_f: centripetalF.toFixed(6),
    axis_ratio_f: axisRatio.toFixed(6),
    ovality_pct: ovalityPct.toFixed(6),
    axis_pairs: [
      {
        group_no: 1,
        axis_code: 'X',
        role: 'MASTER_AXIS_1',
        angle_a_deg: 0,
        angle_b_deg: 180,
        angle_label: '0°—180°',
        diameter_mm: x.toFixed(6),
        position_offset: reg203,
        axis_state: 'NORMAL',
      },
      {
        group_no: 2,
        axis_code: 'Y',
        role: 'SLAVE_AXIS_2',
        angle_a_deg: 90,
        angle_b_deg: 270,
        angle_label: '90°—270°',
        diameter_mm: y.toFixed(6),
        position_offset: reg205,
        axis_state: 'NORMAL',
      },
    ],
    registers: {
      '0x0200_status_word': '0x0002',
      '0x0201_avg_diameter_001mm': reg201,
      '0x0202_axis1_diameter_001mm': reg202,
      '0x0203_axis1_position': reg203,
      '0x0204_axis2_diameter_001mm': reg204,
      '0x0205_axis2_position': reg205,
      '0x003E_run_status': '0x0000',
      '0x0041_avg_diameter_001mm': reg201,
      '0x0042_x_diameter_001mm': reg202,
      '0x0043_y_diameter_001mm': reg204,
      '0x0044_x_position': reg203,
      '0x0045_y_position': reg205,
      '0x0046_pre_e_001mm': Math.round(referenceDiameterMm * 100),
      tx_frame_hex: tx170A,
      rx_frame_hex: rx170A,
      opmac_bl_tx_hex: txOpmacBL,
      opmac_bl_rx_hex: rxOpmacBL,
    },
  };
}

export function validateDetector(d:Detector){keys(d,['name','device_id','metric','step_m','speed_m_min','lower','upper']);named(d.name);insist(typeof d.device_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,89}$/.test(d.device_id),'设备标识无效');insist(metrics.includes(d.metric),'不支持的检测项');insist(fixed(d.step_m)>0n&&fixed(d.speed_m_min,600)>0n,'采样步长和线速必须大于0');insist(d.lower!==''||d.upper!=='','至少设置一个测试检测界限');if(d.lower!=='')fixed(d.lower);if(d.upper!=='')fixed(d.upper);if(d.lower!==''&&d.upper!=='')insist(fixed(d.lower)<=fixed(d.upper),'下限不能大于上限');return d;}
export function detect(d:Detector,g:Geometry,method='legacy-percent'){
 const ratio=d.metric==='OVALITY'&&method==='roundness-min-max.v1';
 insist(Number(g.diameter_x_mm)>0&&Number(g.diameter_y_mm)>0,'双轴直径必须大于0');
 const n=(v:string)=>Number(v),unit=d.metric==='WIRE_GAP'?'mm':ratio?'1':'%';
 const measured=d.metric==='SHIELD_OVERLAP_RATE'?100*n(g.overlap_width_mm)/n(g.tape_width_mm):d.metric==='WIRE_GAP'?n(g.wire_gap_mm):ratio?Math.min(n(g.diameter_x_mm),n(g.diameter_y_mm))/Math.max(n(g.diameter_x_mm),n(g.diameter_y_mm)):200*Math.abs(n(g.diameter_x_mm)-n(g.diameter_y_mm))/(n(g.diameter_x_mm)+n(g.diameter_y_mm));
 const value=measured.toFixed(10).replace(/0+$/,'').replace(/\.$/,'');
 const abnormal=d.lower!==''&&Number(value)<n(d.lower)||d.upper!==''&&Number(value)>n(d.upper);
 let observation:Record<string,unknown>;
 if(d.metric==='SHIELD_OVERLAP_RATE'){
  observation={tape_width_mm:g.tape_width_mm,overlap_width_mm:g.overlap_width_mm};
 }else if(d.metric==='WIRE_GAP'){
  observation={wire_gap_mm:g.wire_gap_mm};
 }else{
  const x=n(g.diameter_x_mm),y=n(g.diameter_y_mm);
  observation=buildOpmac170A2DObservation({
   diameterXMm:x,
   diameterYMm:y,
   dataStatus:'VALID',
   posX:8,
   posY:-14,
   referenceDiameterMm:x,
   abnormal,
  });
 }
 return {value,unit,result:abnormal?'FAIL':'PASS',observation,algorithm:d.metric==='OVALITY'?(ratio?'roundness-min-max.v1':'sim-legacy-percent-mean.v1'):d.metric==='SHIELD_OVERLAP_RATE'?'sim-overlap-width-ratio.v1':'sim-wire-gap-direct.v1'};
}
