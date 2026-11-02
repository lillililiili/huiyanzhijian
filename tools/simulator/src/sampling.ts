import {fixed,decimal,insist} from './cable-model';

export function samplingInterval(value:unknown):number {
 insist(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=60000,'采样间隔须为1～60000的整数毫秒');
 return value as number;
}
export function timeSampleCount(length:string,speed:string,interval:number){
 const distance=fixed(length)*60000n,perTick=fixed(speed,600)*BigInt(samplingInterval(interval));
 insist(distance>0n&&perTick>0n,'线长和送料速度必须大于0');
 return Number((distance+perTick-1n)/perTick);
}
export function timePosition(index:number,speed:string,interval:number){return fixed(speed,600)*BigInt(interval)*BigInt(index)/60000n;}
export function nominalStep(speed:string,interval:number){return decimal(timePosition(1,speed,interval));}
